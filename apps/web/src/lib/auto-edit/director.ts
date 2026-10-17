import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParsedBetaMessage } from "@anthropic-ai/sdk/lib/beta-parser";
import type { z } from "zod";
import { PRICE_PER_MTOK, assertCanSpend, estimateUsd, getActivePromptWith, mapAnthropicError, recordLlmSpend } from "@/lib/claude/core";
import { LlmCallError, PINNED_MODEL_PER_TASK, type Task } from "@/lib/claude/types";
import { EditPlan, Review, type AutoEditMode, type ReviewIssue } from "./plan-schema";

/**
 * Claude as the editor: plan, review a rendered preview, fix, revise.
 * Same steps as llmCall() (spend guard, key from Vault, prompts from
 * prompt_versions, spend recorded per call) through the server-only-
 * free core, plus what these calls need on top:
 * - streaming: a request this large is refused without it;
 * - images: sampled source frames and preview frames, base64;
 * - prompt caching: the system prompt (shared prompt + mode block) and
 *   the ad context (script, scenes, frames) are a byte-identical prefix
 *   across one run's plan, review and fix calls, with a cache
 *   breakpoint after each;
 * - server-side refusal fallback ("default").
 */

export type FrameImage = { label: string; jpeg: Buffer };

export type AdContext = {
  /** The ad as Claude reads it: script, scenes, clip durations, voiceover, brand look. */
  ad: Record<string, unknown>;
  /** Sampled frames of the source footage, labelled by scene and time. */
  frames: FrameImage[];
};

export type ClaudeCallRecord = {
  label: string;
  model: string;
  ms: number;
  stop: string | null;
  usage: { input: number; output: number; cacheWrite: number; cacheRead: number };
  usd: number;
};

const MODEL = PINNED_MODEL_PER_TASK.auto_edit_plan;
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export type DirectorOptions = {
  supabase: SupabaseClient;
  orgId: string;
  brandId: string;
  adId: string;
  mode: AutoEditMode;
  apiKey: string;
  context: AdContext;
  /** Called after every Claude call, once its spend is recorded. */
  onCall?: (rec: ClaudeCallRecord) => Promise<void> | void;
  /** For tests: an Anthropic client to use instead of a real one. */
  client?: Anthropic;
};

export class Director {
  private client: Anthropic;
  private system: string | null = null;

  constructor(private readonly o: DirectorOptions) {
    // Explicit base URL: a container may set ANTHROPIC_BASE_URL for
    // other traffic, which the SDK would otherwise pick up.
    this.client = o.client ?? new Anthropic({ apiKey: o.apiKey, baseURL: "https://api.anthropic.com", maxRetries: 3 });
  }

  private async prompt(task: Task): Promise<string> {
    return (await getActivePromptWith(this.o.supabase, task)).body;
  }

  private async systemPrompt(): Promise<string> {
    if (this.system == null) {
      const [shared, mode] = await Promise.all([
        this.prompt("auto_edit_system"),
        this.prompt(this.o.mode === "designed" ? "auto_edit_mode_designed" : "auto_edit_mode_clean"),
      ]);
      this.system = `${shared}\n\n${mode}`;
    }
    return this.system;
  }

  /** The cached prefix of every call's user turn: the ad and its source frames. */
  private adBlocks(): Anthropic.Beta.BetaContentBlockParam[] {
    const blocks: Anthropic.Beta.BetaContentBlockParam[] = [
      { type: "text", text: `AD\n${JSON.stringify(this.o.context.ad)}` },
    ];
    for (const f of this.o.context.frames) {
      blocks.push({ type: "text", text: f.label });
      blocks.push(jpegBlock(f.jpeg));
    }
    const last = blocks[blocks.length - 1] as { cache_control?: { type: "ephemeral" } };
    last.cache_control = { type: "ephemeral" };
    return blocks;
  }

  private async call<S extends z.ZodTypeAny>(label: string, schema: S, tail: Anthropic.Beta.BetaContentBlockParam[]): Promise<z.infer<S>> {
    const { supabase, orgId, brandId, adId } = this.o;
    await assertCanSpend(supabase, orgId, brandId);
    const system = await this.systemPrompt();
    const t0 = performance.now();
    let res: ParsedBetaMessage<z.infer<S>>;
    try {
      res = await this.client.beta.messages
        .stream({
          model: MODEL,
          max_tokens: 64000,
          betas: [FALLBACK_BETA],
          fallbacks: "default",
          thinking: { type: "adaptive" },
          // One effort for every call in a run: changing it would
          // invalidate the cached prefix.
          output_config: { effort: "high", format: betaZodOutputFormat(schema) },
          system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: [...this.adBlocks(), ...tail] }],
        })
        .finalMessage();
    } catch (err) {
      if (err instanceof Anthropic.APIError || err instanceof Anthropic.APIConnectionError) throw mapAnthropicError(err);
      throw new LlmCallError(`${label}: Claude's answer did not match the edit format (${err instanceof Error ? err.message : String(err)})`, "VALIDATION", err);
    }
    const model = res.model ?? MODEL;
    const usage = res.usage;
    // A fallback model is priced as itself; an unpriced one as the pinned model.
    const usd = estimateUsd(PRICE_PER_MTOK[model] ? model : MODEL, usage);
    await recordLlmSpend(supabase, { orgId, adId, model, usd, task: `auto_edit_${label}` });
    const rec: ClaudeCallRecord = {
      label,
      model,
      ms: Math.round(performance.now() - t0),
      stop: res.stop_reason ?? null,
      usage: {
        input: usage.input_tokens,
        output: usage.output_tokens,
        cacheWrite: usage.cache_creation_input_tokens ?? 0,
        cacheRead: usage.cache_read_input_tokens ?? 0,
      },
      usd,
    };
    await this.o.onCall?.(rec);
    if (res.stop_reason === "refusal") {
      throw new LlmCallError("Claude declined to edit this ad. Try the other mode, or check the footage and script for anything that could be read as unsafe.", "NEEDS_HUMAN", res.stop_details);
    }
    if (res.stop_reason === "max_tokens") throw new LlmCallError(`${label}: Claude's answer was cut off`, "PROVIDER_ERROR");
    if (res.parsed_output == null) throw new LlmCallError(`${label}: Claude's answer did not parse`, "VALIDATION");
    return res.parsed_output;
  }

  async plan(): Promise<EditPlan> {
    return this.call("plan", EditPlan, [{ type: "text", text: await this.prompt("auto_edit_plan") }]);
  }

  /** Lint problems or review issues back into the plan. */
  async fix(plan: EditPlan, problems: string[], label = "fix"): Promise<EditPlan> {
    return this.call(label, EditPlan, [
      { type: "text", text: `Your plan:\n${JSON.stringify(plan)}\n\nIt has these problems:\n- ${problems.join("\n- ")}` },
      { type: "text", text: await this.prompt("auto_edit_fix") },
    ]);
  }

  async review(plan: EditPlan, previewFrames: FrameImage[]): Promise<Review> {
    const tail: Anthropic.Beta.BetaContentBlockParam[] = [
      { type: "text", text: `The plan that was rendered:\n${JSON.stringify(plan)}\n\nFrames sampled from the rendered preview:` },
    ];
    for (const f of previewFrames) tail.push({ type: "text", text: f.label }, jpegBlock(f.jpeg));
    tail.push({ type: "text", text: await this.prompt("auto_edit_review") });
    return this.call("review", Review, tail);
  }

  /** A revision chat turn. findings are the review fixes that still hold; they always go with the request. */
  async revise(plan: EditPlan, instruction: string, findings: ReviewIssue[]): Promise<EditPlan> {
    const kept = findings.length
      ? `\n\nReview fixes already in this plan (they still hold):\n- ${findings.map((i) => `${i.problem} (fixed by: ${i.fix})`).join("\n- ")}`
      : "";
    return this.call("revise", EditPlan, [
      { type: "text", text: `Current plan:\n${JSON.stringify(plan)}${kept}\n\nThe client asks: ${JSON.stringify(instruction)}` },
      { type: "text", text: await this.prompt("auto_edit_revise") },
    ]);
  }
}

function jpegBlock(jpeg: Buffer): Anthropic.Beta.BetaImageBlockParam {
  return { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") } };
}

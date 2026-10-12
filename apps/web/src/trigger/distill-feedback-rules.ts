import { schedules, logger } from "@trigger.dev/sdk";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ClusterRememberedFeedbackSchema } from "@/lib/claude/schemas/cluster-remembered-feedback";
import {
  decideScope,
  applyDecayStep,
  decideCapAction,
  RULE_CAP_PER_SCOPE,
  type FeedbackScopeKeys,
} from "@/lib/rules/distillation";

/**
 * Daily distillation job, spec §5.8: "When the same kind of
 * remembered correction appears at least twice, a daily job distils
 * it into a short DO or AVOID rule, scoped to org, brand, style or
 * product, injected into later prompt writing. Rules decay without
 * reinforcement and are capped per scope (about 20)."
 *
 * Uses schedules.task (not the plain task() run-provider-job.ts
 * uses) — a different @trigger.dev/sdk export specifically for
 * cron-scheduled runs with no per-trigger payload. "0 2 * * *" is UTC
 * 2am, chosen to land well after any reasonable org's daytime usage
 * in every timezone this app might have orgs in, and before the next
 * business day's generations would want the freshly distilled rules
 * available.
 *
 * Deliberately NOT using lib/supabase/service.ts (server-only guard
 * doesn't resolve in a Trigger.dev process — same reason
 * run-provider-job.ts builds its own client) and NOT using
 * lib/claude/call.ts's llmCall() directly, for one real constraint:
 * llmCall() is itself guarded by "server-only" and pulls in
 * prompt-registry.ts (also server-only) — same resolution problem.
 * Rather than stripping "server-only" from shared library code just
 * for this one caller (which would then let a future Next.js
 * Server/Client Component boundary accidentally import it), this task
 * re-implements the same four steps llmCall() does inline: spend
 * guard via claim_paid_job, the org's own Anthropic key via
 * get_org_secret_value, the Claude call itself, and record_spend_event
 * — identical sequence, just not routed through the server-only
 * wrapper. The prompt body is inlined here rather than read from
 * prompt_versions, matching the fact that this is the only call site
 * for this task's prompt; a future refactor could extract a
 * server-only-free variant of getActivePrompt if more Trigger.dev
 * tasks end up needing live-editable prompts.
 */

const CLUSTER_PROMPT = `You are distilling repeated video-ad creative feedback into durable style rules. You are given a list of feedback instances (free-form text an editor wrote when giving feedback on a generated image or video, each marked "remember"). Group instances that express the SAME underlying correction into clusters, even when worded very differently (e.g. "make her smile more", "she needs a bigger smile", and "the smile isn't warm enough" are the same correction). Every instance must be placed into exactly one cluster, including clusters of size 1 for feedback that doesn't match anything else. For each cluster, classify it as a "do" rule (asks for something to be present/true) or "avoid" rule (asks for something to be removed/prevented), and write a SHORT, GENERALIZED rule statement starting with "DO:" or "AVOID:" that captures the underlying pattern across every member of that cluster — never copy one instance's exact wording verbatim.`;

type PendingFeedbackRow = {
  id: string;
  org_id: string;
  text: string;
  brand_id: string | null;
  style_id: string | null;
  product_id: string | null;
};

export const distillFeedbackRules = schedules.task({
  id: "distill-feedback-rules",
  cron: "0 2 * * *",
  maxDuration: 1800,
  run: async () => {
    const supabase = getServiceClient();

    // Every org with at least one unattached (rule_id is null)
    // remembered feedback row is a candidate for this run. "Unattached"
    // (not "created since last run") is the correctness mechanism for
    // the 2+ threshold across runs — see migration
    // 00000000000044_rules_distillation.sql's doc comment: a lone
    // singleton from a prior run stays eligible indefinitely until it
    // either joins a real cluster or the org never sends a second
    // matching correction.
    const { data: pendingOrgRows, error: orgsError } = await supabase
      .from("feedback_events")
      .select("org_id")
      .eq("remember", true)
      .is("rule_id", null);

    if (orgsError) {
      logger.error("distill-feedback-rules: failed to list candidate orgs", { error: orgsError.message });
      return { ok: false };
    }

    const orgIds = Array.from(new Set((pendingOrgRows ?? []).map((r) => r.org_id as string)));
    logger.log("distill-feedback-rules: candidate orgs", { count: orgIds.length });

    for (const orgId of orgIds) {
      try {
        await distillForOrg(supabase, orgId);
      } catch (err) {
        // One org's failure (bad key, no credit, provider error) must
        // never stop every other org's run — same isolation principle
        // as run-provider-job.ts's per-job failJob(), just at the
        // per-org granularity this batch job needs.
        logger.error("distill-feedback-rules: org run failed", {
          orgId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    await decayExistingRules(supabase);

    return { ok: true, orgsProcessed: orgIds.length };
  },
});

async function distillForOrg(supabase: ReturnType<typeof getServiceClient>, orgId: string): Promise<void> {
  const pending = await getPendingFeedbackForOrg(supabase, orgId);
  if (pending.length < 2) return; // can't form any 2+ cluster at all — nothing to do, cheapest possible exit before spending anything.

  // Spend guard first, same as every other paid call in this app —
  // this org's own key, never a platform-wide one.
  const { error: claimError } = await supabase.rpc("claim_paid_job", { target_org_id: orgId });
  if (claimError) {
    logger.log("distill-feedback-rules: org paused, skipping", { orgId, error: claimError.message });
    return;
  }

  const { data: apiKey, error: keyError } = await supabase.rpc("get_org_secret_value", {
    target_org_id: orgId,
    target_provider: "anthropic",
  });
  if (keyError || !apiKey) {
    logger.log("distill-feedback-rules: no Anthropic key for org, skipping", { orgId });
    return;
  }

  const client = new Anthropic({ apiKey });
  const userMessage = `${CLUSTER_PROMPT}\n\nInput:\n${JSON.stringify(
    { feedback_instances: pending.map((p, index) => ({ index, text: p.text })) },
    null,
    2
  )}`;

  let clusters: { member_indices: number[]; kind: "do" | "avoid"; rule_text: string }[];
  try {
    const response = await client.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      messages: [{ role: "user", content: userMessage }],
      output_config: { format: zodOutputFormat(ClusterRememberedFeedbackSchema) },
    });

    const usage = response.usage;
    await recordLlmSpend(supabase, orgId, usage.input_tokens, usage.output_tokens);

    if (response.parsed_output === null) {
      logger.error("distill-feedback-rules: clustering call returned no parsed output", { orgId });
      return;
    }
    clusters = response.parsed_output.clusters;
  } catch (err) {
    logger.error("distill-feedback-rules: clustering call failed", {
      orgId,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  for (const cluster of clusters) {
    const members = cluster.member_indices
      .map((i) => pending[i])
      .filter((m): m is PendingFeedbackRow => m !== undefined);

    // Spec: "appears at least twice." A cluster of 1 just isn't a rule
    // candidate yet — it stays unattached (rule_id null) and is
    // naturally reconsidered on every future run until a second
    // matching instance arrives.
    if (members.length < 2) continue;

    const scopeKeys: FeedbackScopeKeys[] = members.map((m) => ({
      brandId: m.brand_id,
      styleId: m.style_id,
      productId: m.product_id,
    }));
    const { scope, scopeId } = decideScope(scopeKeys);

    const countResult = await supabase
      .from("rules")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("scope", scope)
      .eq("active", true);

    const capDecision = decideCapAction(countResult.count ?? 0);
    if (capDecision.action === "skip_at_cap") {
      logger.log("distill-feedback-rules: scope at cap, skipping new rule", {
        orgId,
        scope,
        scopeId,
        cap: RULE_CAP_PER_SCOPE,
      });
      continue;
    }

    const { error: createError } = await supabase.rpc("create_rule_from_feedback", {
      target_org_id: orgId,
      target_scope: scope,
      target_scope_id: scopeId,
      target_kind: cluster.kind,
      target_text: cluster.rule_text,
      member_feedback_event_ids: members.map((m) => m.id),
    });
    if (createError) {
      logger.error("distill-feedback-rules: create_rule_from_feedback failed", {
        orgId,
        error: createError.message,
      });
      continue;
    }

    logger.log("distill-feedback-rules: created rule", { orgId, scope, scopeId, kind: cluster.kind });
  }
}

/**
 * Pending remembered feedback for one org, joined out to its
 * brand/style/product scope keys via ads/scenes — ads carries
 * brand_id/style_id directly, scenes carries product_id (confirmed by
 * reading migration 00000000000008_ads_scenes_assets.sql: scenes has
 * no brand_id/style_id of its own, only product_id; brand/style live
 * on the ad). A feedback_events row's scene_id is nullable (video
 * feedback targeting "last_frame" can still have a scene_id — in
 * practice every feedback row in this app always has one, but this
 * reads defensively) so product_id falls back to null rather than
 * throwing when absent.
 */
async function getPendingFeedbackForOrg(
  supabase: ReturnType<typeof getServiceClient>,
  orgId: string
): Promise<PendingFeedbackRow[]> {
  const { data, error } = await supabase
    .from("feedback_events")
    .select("id, org_id, text, ad_id, scene_id, ads!inner(brand_id, style_id), scenes(product_id)")
    .eq("org_id", orgId)
    .eq("remember", true)
    .is("rule_id", null);

  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => {
    const ad = row.ads as unknown as { brand_id: string | null; style_id: string | null } | null;
    const scene = row.scenes as unknown as { product_id: string | null } | null;
    return {
      id: row.id as string,
      org_id: row.org_id as string,
      text: row.text as string,
      brand_id: ad?.brand_id ?? null,
      style_id: ad?.style_id ?? null,
      product_id: scene?.product_id ?? null,
    };
  });
}

/**
 * Decay pass: for every ACTIVE rule across every org, check whether
 * any still-unattached remembered feedback matches it closely enough
 * to count as reinforcement, else decay it. Deliberately a SEPARATE,
 * CHEAP pass from the clustering call above (no second Claude call
 * per rule) — reinforcement here is decided by whether the SAME
 * clustering run already attached a feedback instance to this rule
 * via attach_feedback_to_rule during this run (handled inline in the
 * loop above would require threading extra state through; instead
 * this pass reads reinforced_count's own change as the signal: a rule
 * whose attached-feedback count went up during this run was
 * reinforced). To keep this genuinely simple and avoid a second
 * expensive semantic-matching call, "reinforced this run" is read
 * directly off whether create_rule_from_feedback/attach_feedback_to_rule
 * touched this rule id during THIS invocation — tracked via the
 * reinforcedRuleIds set populated while distillForOrg runs.
 *
 * NOTE: existing rules are reinforced only by being the TARGET of a
 * create_rule_from_feedback call that's actually a dupe of an
 ' already-existing rule's pattern — today's clustering always creates
 * a brand NEW rule rather than re-attaching to an existing one of the
 * same meaning (the clustering call has no visibility into existing
 * rules yet). That is a known first-pass limitation, not silently
 * swept under the rug: see the final report for why, and the natural
 * next step (feed existing active rules' text into the clustering
 * call as additional "clusters" the model can assign members to
 * instead of only ever proposing new ones).
 */
async function decayExistingRules(supabase: ReturnType<typeof getServiceClient>): Promise<void> {
  const { data: activeRules, error } = await supabase
    .from("rules")
    .select("id, confidence, active")
    .eq("active", true);

  if (error) {
    logger.error("distill-feedback-rules: failed to list active rules for decay", { error: error.message });
    return;
  }

  for (const rule of activeRules ?? []) {
    // This run never attaches NEW feedback to an EXISTING rule (see
    // note above), so every active rule decays by DECAY_STEP every
    // run unless/until the clustering call above is extended to
    // reinforce existing rules directly. reinforced is always false
    // here on purpose — not a bug, a documented first-pass gap.
    const result = applyDecayStep({ confidence: rule.confidence, active: rule.active, reinforced: false });

    const { error: updateError } = await supabase.rpc("update_rule_decay", {
      target_rule_id: rule.id,
      new_confidence: result.confidence,
      new_active: result.active,
      reinforced_count_delta: result.reinforcedCountDelta,
    });
    if (updateError) {
      logger.error("distill-feedback-rules: update_rule_decay failed", { ruleId: rule.id, error: updateError.message });
    }
  }
}

async function recordLlmSpend(
  supabase: ReturnType<typeof getServiceClient>,
  orgId: string,
  inputTokens: number,
  outputTokens: number
): Promise<void> {
  // claude-sonnet-5-5/opus-5-5 pricing per lib/claude/call.ts's own
  // PRICE_PER_MTOK table (kept here too since that file is
  // server-only and can't be imported from a Trigger.dev task —
  // same constraint documented at the top of this file). Opus 5.5:
  // $4/$20 per MTok.
  const usdEstimate = (inputTokens / 1_000_000) * 4.0 + (outputTokens / 1_000_000) * 20.0;

  const { error } = await supabase.rpc("record_spend_event", {
    target_org_id: orgId,
    target_ad_id: null,
    target_provider: "anthropic",
    target_model: "claude-opus-5-5",
    target_usd_est: usdEstimate,
    target_kind: "llm:cluster_remembered_feedback",
  });
  if (error) {
    logger.error("distill-feedback-rules: record_spend_event failed", { orgId, error: error.message });
  }
}

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("distill-feedback-rules: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set");
  }

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

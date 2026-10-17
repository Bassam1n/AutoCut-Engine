import { describe, it, expect } from "vitest";
import { HIGGSFIELD_PLAN_MODELS, buildPlanParams, parseJobStatus, parseSubmittedJobId } from "./higgsfield-plan-adapter";
import { adapterFor } from "./adapter-for";

const JOB = "1d4d8425-20fe-4a2e-9c4f-0342801ddbc3";

// Real generate_image / job_status texts from a live plan-credit test (2026-10-17).
const SUBMIT_TEXT = `Note: adjustments applied — params.quality: "(unset)" → "2k" (default for model).

Submitted 1 job. If a widget is visible, it polls automatically — do not call job_status or show_generations as a follow-up poll. In text-only clients, use job_status with sync:true to poll for completion.
- ${JOB}  "A white ceramic coffee mug on a wooden table beside a sunlit window, soft natural light, product photo."
If the user requests a combined display of multiple generations, collect all requested job IDs.`;

const COMPLETED_TEXT = `Job ${JOB} — completed
https://d8j0ntlcm91z4.cloudfront.net/user_3KpGVoza096FFTtwTJ6cREDbXZH/hf_20261017_144924_${JOB}.png`;

const TOKENS = JSON.stringify({ clientId: "c", accessToken: "a", refreshToken: "r", expiresAt: null });

describe("HiggsfieldPlanAdapter helpers", () => {
  it("adapterFor() builds the plan adapter from the stored login", () => {
    expect(adapterFor("higgsfield_plan", TOKENS).provider).toBe("higgsfield_plan");
  });

  it("adapterFor() refuses an unreadable stored login", () => {
    expect(() => adapterFor("higgsfield_plan", "not json")).toThrow(/unreadable/);
  });

  it("parseSubmittedJobId() reads the job id line", () => {
    expect(parseSubmittedJobId(SUBMIT_TEXT)).toBe(JOB);
  });

  it("parseJobStatus() maps a completed job to its result URL", () => {
    expect(parseJobStatus(COMPLETED_TEXT, JOB)).toMatchObject({
      status: "succeeded",
      resultUrls: [`https://d8j0ntlcm91z4.cloudfront.net/user_3KpGVoza096FFTtwTJ6cREDbXZH/hf_20261017_144924_${JOB}.png`],
    });
  });

  it("parseJobStatus() puts a video before its thumbnail", () => {
    const text = `Job ${JOB} — completed\nhttps://cdn.test/thumb.webp\nhttps://cdn.test/clip.mp4`;
    expect(parseJobStatus(text, JOB).resultUrls).toEqual(["https://cdn.test/clip.mp4", "https://cdn.test/thumb.webp"]);
  });

  it("parseJobStatus() keeps polling while in progress", () => {
    expect(parseJobStatus(`Job ${JOB} — in_progress`, JOB).status).toBe("running");
  });

  it("parseJobStatus() maps nsfw to CONTENT_BLOCK and failed to PROVIDER_ERROR", () => {
    expect(parseJobStatus(`Job ${JOB} — nsfw`, JOB)).toMatchObject({ status: "failed", errorCode: "CONTENT_BLOCK" });
    expect(parseJobStatus(`Job ${JOB} — failed`, JOB)).toMatchObject({ status: "failed", errorCode: "PROVIDER_ERROR" });
  });

  it("buildPlanParams() bills plan credits and maps reference images to the model's role", () => {
    const params = buildPlanParams(
      { kind: "image", model: "gpt_image_2_5", prompt: "p", aspectRatio: "9:16", extra: { quality: "high", num_images: 4 } },
      HIGGSFIELD_PLAN_MODELS.gpt_image_2_5,
      ["m1", "m2"]
    );
    expect(params).toEqual({
      model: "gpt_image_2_5",
      prompt: "p",
      count: 1,
      use_unlim: false,
      aspect_ratio: "9:16",
      medias: [
        { value: "m1", role: "image_references" },
        { value: "m2", role: "image_references" },
      ],
      quality: "high",
    });
  });

  it("buildPlanParams() sends the start frame and an integer duration for video", () => {
    const params = buildPlanParams(
      { kind: "video", model: "kling3_0", prompt: "push in", aspectRatio: "9:16", extra: { duration: "7", sound: "off" } },
      HIGGSFIELD_PLAN_MODELS.kling3_0,
      ["frame"]
    );
    expect(params).toMatchObject({ medias: [{ value: "frame", role: "start_image" }], duration: 7, sound: "off" });
  });

  it("buildPlanParams() sends no media to a prompt-only model", () => {
    const params = buildPlanParams({ kind: "image", model: "soul_2", prompt: "p" }, HIGGSFIELD_PLAN_MODELS.soul_2, []);
    expect(params).not.toHaveProperty("medias");
  });
});

import { defineConfig } from "@trigger.dev/sdk";

/**
 * Minimal async job runner for work that can't fit the inline
 * submit-then-poll pattern used so far (generate-reference-image.ts) —
 * spec §5.7 requires Scene videos to survive a tab close/reload and
 * poll for up to ~20 minutes, which a single serverless function
 * invocation (even with a raised maxDuration) can't do. Tasks live
 * under src/trigger/; each one's own maxDuration is set per-task
 * rather than here, since different job kinds have very different
 * real durations (image generation vs. a long video render).
 */
export default defineConfig({
  project: "proj_jzhthkcmtmliihnojvqe",
  dirs: ["./src/trigger"],
  maxDuration: 1800,
});

# Concat + Hyperframes proof: report

Status: **done. Go, with conditions** (see section 10).
- Concat builds from source and is driven only through its JSON-RPC API.
- Transparency is settled: ProRes 4444 overlays work.
- Claude directed the real ad end to end in both modes, plus one revision turn. All three runs produced a 30 s 1080x1920 H.264 ad with no manual edits.
- About $0.31 to $0.42 of Claude per ad, 5 to 6 min wall clock on 4 vCPU without a GPU. A revision costs about $0.12 and 3 min.
- Four bugs blocked the first Claude run. All are fixed on this branch (section 5).

## Pinned versions
- Concat: `jub0t/Concat` @ `60ecb4a1fda62501f67afaf7e036143c95f196f8` (engine 0.2.7, `apiVersion` 0.2). Unmodified, AGPL-3.0.
- Hyperframes: npm `hyperframes@0.8.168`, the same version as repo HEAD `5e7ba0be944b076d514fc082c25a0b7e35eeb42f`. Apache-2.0.
- FFmpeg: Concat's pinned BtbN build `ffmpeg-n8.1.3-9-g29e619e767-linux64-gpl-shared-8.1`, sha256 checked. ONNX Runtime 1.28.0, also Concat's pin.
- Rust 1.93.1. Mesa lavapipe as the software Vulkan driver. Headless Chromium for Hyperframes. GSAP 3.14.2, copied in at render time and not committed.
- Anthropic TypeScript SDK 0.135 with zod 4, model `claude-opus-5-5`.

## 1. Build: works
- Ubuntu 24.04 ships FFmpeg 6.1, which is too old, so this uses the BtbN shared build that Concat's own CI pins, through `FFMPEG_DIR`.
- ONNX Runtime comes in through `ORT_LIB_LOCATION` and `ORT_PREFER_DYNAMIC_LINK=1`, so the build downloads nothing itself.
- System packages: Concat CI's list. Without `libasound2-dev` the build fails at `alsa-sys`.
- `cargo build --release -p concat-cli` takes about 3 min of compile on 4 vCPU / 15 GB. The binary is 31.6 MB.
- Build scripts were reviewed and are benign: link flags, an embedded effects table, and opt-in protobuf codegen.
- `setup.sh` rebuilds the whole toolchain in a fresh container.

API facts used by `src/concat.mjs` and `src/execute.mjs`:
- Methods: `project.create/get/save`, `media.import`, `edit.apply` (ops `addClip`, `trimClip`, `updateClip`, `setClipKey`, `addTextClip`, `addFont`, `batch`), and `export.run`, which streams `export.progress/done/failed` events.
- Times are in seconds. Tracks are numbered from the bottom: `T1` is the lowest.
- `addClip` takes the whole media file; trim it afterwards.
- A transition is set on the incoming clip and needs spare footage on both sides of the cut.
- Export always composites on wgpu (lavapipe here). The only quality controls are crf and preset; there is no bitrate setting.

## 2. Transparency verdict
Test: `src/test-alpha.mjs`. Each overlay was placed on T2 over the ad's scene 01 clip on T1, rendered with `preview.frame`, and compared with a footage-only frame. Results are in `alpha-results.json` (the contact sheet is sent to the user, not committed).

| Overlay | Result | Footage unchanged |
|---|---|---|
| Hyperframes ProRes 4444 `.mov` (`yuva444p12le`) | **works**, alpha respected | 83.9% |
| Transparent PNG still (control) | **works** | 83.9% |
| Hyperframes VP9-alpha `.webm` | **fails**: alpha dropped, whole frame black around the graphic | 0.8% |
| Concat title (`addTextClip`) | **works** | 87.3% |
| Hyperframes opaque MP4 + `screen` blend | not usable: Hyperframes flattens transparent areas to white in MP4, and screen over white is white | 0.4% |

- **Why VP9 fails:** Concat opens decoders by codec id, which gives FFmpeg's native `vp9` decoder. That decoder ignores the alpha side-channel; only `libvpx-vp9` keeps it.
- **ProRes works** because the native ProRes decoder outputs `yuva444p12le`, Concat converts it to `rgba`, and the compositor multiplies by source alpha.

**Chosen approach:**
- Overlays: Hyperframes renders to ProRes 4444 `.mov` on an upper track.
- Full-frame cards (end card): opaque MP4 on the top track.
- Captions: Concat titles. They need no render step and stay crisp.
- No change to Concat is needed.

## 3. Claude-directed edit
Pipeline (`src/run.mjs`):
1. Context: the script, the scenes with clip durations, and 3 sampled frames per scene.
2. Claude returns an `EditPlan` (`src/plan-schema.mjs`) through structured outputs.
3. Checks the schema can't express: handles, frame edges, length, caption overlaps. Any problems go back to Claude, at most 2 rounds.
4. Hyperframes renders the graphics, cached by content hash.
5. The plan is applied through the Concat API.
6. A 540x960 preview is rendered. Up to 16 frames are sampled at clip midpoints, captions and graphics. Claude reviews them and returns a verdict and issues. On "fix", a second call applies the issues to the plan, which is linted again.
7. The final 1080x1920 MP4 is rendered.

`--revise "make it punchier" --from final-plan.json` is the later chat turn. It rewrites the same plan format. The review findings saved next to the plan go into this call as constraints.

Two modes share the plan; only the graphics differ:
- `--mode template`: Claude picks one of three templates (hookPill, callout, endCard) and writes its text and colours.
- `--mode direct`: Claude writes each motion graphic itself as CSS, HTML and GSAP timeline code. Captions, trims, transitions and zooms are Claude's in both modes.

The ad: the demo org's cold brew ad, 6 scenes. The clips came from the user as 720x1280 at 24 fps, 4.0 to 6.0 s each. There is **no voiceover**, so captions carry the script and their timing comes from the scene copy and durations.

Executor test with a hand-written plan (`fixtures/executor-test-plan.json`, not Claude output; it checks the machinery):
- Output: 30.0 s, 1080x1920, 30 fps, H.264 + AAC.
- Contents: six trimmed clips, one cross-fade, two Ken Burns moves, 8 captions, a ProRes hook overlay, and a full-frame end card.
- All of it renders correctly (frames checked visually).

## 4. Results of the Claude-directed runs
Model `claude-opus-5-5`, adaptive thinking, effort high (medium for lint fixes). Same 6 clips, same machine. Plans, reviews and metrics are in `results/`. The MP4s, previews and contact sheets were sent to the user and are not committed.

| Run | Claude calls | Input / output tokens | Claude cost | Claude time | Wall clock | Output |
|---|---|---|---|---|---|---|
| template | plan, review, reviewFix | 27,722 / 10,012 | **$0.311** | 94 s | 298 s | 30.0 s, 5 clips, 11 captions, 3 graphics |
| direct | plan, review, reviewFix | 33,781 / 14,302 | **$0.421** | 128 s | 364 s | 31.0 s, 6 clips, 19 captions, 4 graphics |
| template + revise "make it punchier" | revise | 7,926 / 4,292 | **$0.118** | 38 s | 184 s | 30.0 s, 7 shots (2 jump-cut punch-ins), 12 captions, 4 graphics |

Per call:

| Call | template | direct | revise |
|---|---|---|---|
| plan (18 sampled frames + script) | 32.5 s, 11.3k in / 3.5k out, $0.116 | 63.9 s, 11.5k / 6.8k, $0.182 | |
| review (up to 16 preview frames) | 47.0 s, 8.3k / 4.6k, $0.125 | 34.6 s, 11.9k / 3.2k, $0.112 | |
| reviewFix | 14.2 s, 8.1k / 1.9k, $0.070 | 29.3 s, 10.3k / 4.3k, $0.127 | |
| revise | | | 37.6 s, 7.9k / 4.3k, $0.118 |

- Prices: $4 / $20 per million input / output tokens. No prompt caching was used; every cache read was 0.
- Output tokens include adaptive thinking. Output is about two-thirds of the cost, input about one-third.
- Direct mode costs about 35% more. Claude writes the graphic code (700 to 1,760 characters per graphic), and its plan call takes twice as long.

### Review findings
The review step did real work in both modes. It found problems no lint rule could catch.

Template mode (verdict fix, 3 issues):
1. **Scene 04's footage shows a can with a large, legible COSTA COFFEE logo**, a competitor brand, for the whole clip. Fix: the clip was removed and the time recovered by lengthening scenes 05 and 06.
2. The captions after the removed clip no longer matched their scenes. Fix: new caption timings.
3. The hook pill covered the actor's face, and a caption repeated the pill's line. Fix: the caption was deleted and the shot reframed with a Ken Burns offset.

Direct mode (verdict fix, 2 issues):
1. The same Costa logo. Fix: a "0g added sugar" sticker, coded by Claude, placed over the logo.
2. An orphaned word ("sugar") on the end card's second line. Fix: a smaller font and a wider box. This one worked.

**The direct-mode logo fix did not work.** The sticker is static, but the can moves up through the shot, so "TA" of COSTA shows above the sticker from about 18.5 s. The review saw sampled frames and assumed the logo stays put. Nothing reviews the final render, so this would have shipped. The template run removed the shot instead, and its output is clean.

### Revision turn
- **First attempt, without the review findings:** Claude's "punchier" plan said "all six scenes now in play" and put the Costa clip back. The revise call saw only the plan and the instruction, not why scene 04 was missing. That plan is kept as `results/template-revise/revised-plan-without-review-findings.json` and was not rendered.
- **Fix:** `run.mjs` reads `review.json` next to the `--from` plan and tells Claude those fixes still hold.
- **Second attempt:** "The competitor clip stays out." It added jump-cut punch-ins on scenes 03 and 05, a Ken Burns move on every shot, accent-coloured punchline captions, and a "NEVER BITTER" sticker. The frames check out.

## 5. Bugs found and fixed in this run
1. **Non-streaming request refused.** The SDK will not send `max_tokens: 32000` without streaming because the request could pass 10 min. Calls now use `messages.stream(...).finalMessage()`, which returns the same `parsed_output`.
2. **`z.record` cannot be expressed in structured outputs.** The SDK turns it into an object with no allowed keys, so Claude could only return `captionStyles: {}` and empty template props. The first plan referenced style "main", which could not exist, and failed lint 16 times. Template graphics would have rendered with no text. Fix: caption styles are a named list, template props a fixed set of strings, and lint checks each template's required text.
3. **"Compiled grammar is too large".** The API rejects a schema above a size limit. With records fixed, `Review`, which nested a whole `EditPlan`, went over it; the old one only fit because its records were empty. Fix: the review returns only verdict and issues, and a "fix" verdict goes through `fixPlan` with the EditPlan schema. This costs a second call only when fixes are needed ($0.07 to $0.13). Nullable template props also pushed `EditPlan` over the limit, so unused props are `""`.
4. **Revise undid review fixes.** See above.

After these fixes, every Claude output in the three runs passed schema and lint on the first try: no lint-fix rounds, no refusals, no `max_tokens` stops.

## 6. Render timings (4 vCPU, 15 GB, no GPU, lavapipe)
| Step | Measured |
|---|---|
| Hyperframes overlay → ProRes 4444 (1.8 to 5 s graphics) | 9.9 to 22.7 s each, 15.5 s typical |
| Hyperframes full-frame end card → MP4 (2 to 3 s) | 6.5 to 7.8 s |
| Graphics per ad, 3 to 4, uncached | 36 to 46 s |
| Graphics after a review fix (hash cache) | only the changed ones re-render: 0 to 24 s |
| Concat project build via API | 0.35 to 0.41 s |
| Preview export, 30 s at 540x960, crf 30 veryfast | 25 to 31 s |
| Final export, 30 s at 1080x1920, crf 20 medium | 110 to 130 s (3.7 to 4.3x real time) |
| Re-render of a saved plan, no Claude (graphics + preview + final) | 172 s |
| Peak RSS: concat-cli during export | 1.07 GB |
| Peak RSS: Hyperframes + headless Chromium | 1.76 GB |

- The final export is the largest single cost: about 40% of an ad's wall clock.
- Graphics render one at a time; rendering them in parallel would save about 20 s.
- Exports were deterministic in practice: the same plan re-rendered with matching timings and no failures.

Earlier measurements (executor test, alpha tests and a cold build of about 3 min, now 3m23s for the whole of `setup.sh`) still hold.

## 7. Reliability
In this session, after the fixes:
- **Claude:** 8 calls with the final schema, 8 schema-valid, 0 lint-fix rounds, 0 refusals.
- **Hyperframes:** 17 renders, 0 failures, including 5 graphics whose code Claude wrote itself. Every direct-mode graphic rendered on the first try.
- **Concat:** 7 exports (about 60 API calls per project build), 0 failures.

Caveats:
- One ad and one machine is a small sample.
- The bugs above show the schema needs a contract test. A tiny API call with each schema (`max_tokens: 64`) catches the grammar limit in seconds.
- The pipeline cannot verify its own fixes: the plan after "fix" is rendered straight to final without a second look. That is how the direct-mode logo leak would ship.
- Sampled-frame review misses motion. It saw the logo, but not that the can moves.

## 8. Template vs direct
| | template | direct |
|---|---|---|
| Graphics look | Plain: pill, tilted sticker, flat end card | Clearly better: round badges, a drawn can on the end card, warmer palette |
| Captions | 11, full phrases | 19, sometimes split mid-sentence ("You think black coffee tastes" / "like burnt toast. Fair.") |
| Cost / Claude time | $0.31 / 94 s | $0.42 / 128 s |
| Render risk | None: templates are known-good | None seen in 5 graphics, but Claude's code is untrusted HTML/JS running in Chromium |
| Fix quality | Removed the bad shot: clean | Covered the logo with a static sticker on a moving object: leaked |
| Shippable as rendered | **Yes** | **No** (logo leak at about 18.5 s) |

**Recommendation: template mode by default.** Template mode leaves Claude fewer ways to get things wrong, and those limits made it the safer editor in this run. Direct mode is the better designer. It is worth offering later as a premium style, behind a second review pass and a sandbox (Chromium with no network, a time limit, and code size caps). A middle option is to have Claude write new templates offline, review them by hand, and add them to the library.

## 9. What a Trigger.dev worker needs
- **Runtime image:** Node 22 and the Concat binary (31.6 MB), FFmpeg 8.1 shared libs (203 MB), ONNX Runtime 1.28 (24 MB), headless Chromium (323 MB), Hyperframes + GSAP (130 MB), Mesa lavapipe (`mesa-vulkan-drivers`, `libvulkan1`) and fonts (`fonts-inter`). That is roughly 0.7 GB on top of the base image. Build Concat once in CI, Rust 1.93.1, about 3 min, and copy the binary in. Don't build it in the task.
- **No GPU:** export composites on wgpu through software Vulkan (`VK_ICD_FILENAMES` to lavapipe).
- **Machine:** 4 vCPU, 4 GB minimum; peaks are 1.8 GB (Chromium) and 1.1 GB (Concat), one at a time, plus Node. Exports are CPU-bound, so run one ad per worker. More vCPU should shorten the final export, but that hasn't been measured.
- **Duration:** about 5 to 6 min per new ad and about 3 min per revision. Set the task's max duration to 15 min or more, and stream Claude calls as above.
- **Scratch disk:** 74 to 90 MB per ad measured (clips, frames, ProRes overlays, previews, the final file). Upload the final file to storage and drop the rest.
- **Secrets:** an Anthropic API key. Set the base URL explicitly, as here.
- **Split tasks:** plan → render preview → review → (fix) → render final, as separate steps with the plan JSON passed between them. Then a failed export retries without paying for Claude again, and the user can see the preview while the final renders.
- **Licensing:** Concat is AGPL-3.0. It runs unmodified as a separate process here, but have it legally reviewed before it runs in production.

## 10. Go / no-go
**Go:** build the worker on Concat + Hyperframes, with Claude planning the edit in template mode. On this ad the whole loop worked without a human:
- It understood the footage and caught a brand-safety problem in it.
- It wrote and timed captions for an ad with no voiceover.
- It produced a 30 s ad within the target length.
- It took a natural-language revision.

At about $0.31 to $0.42 per ad and $0.12 per revision, the Claude cost is small next to the footage generation.

Conditions before production:
1. **Review the fixed plan** before the final render: one more preview and review, about 30 s and $0.12. Sample extra frames across each overlay's window, not only its start, so moving subjects are checked.
2. **Store review findings with the plan** (done here through `review.json`; in the app, alongside the plan row) and send them with every revision.
3. **Add a schema contract test** to CI: a tiny API call with each structured-output schema.
4. **Add a brand-safety check at footage generation.** The Costa logo came from the generated clip. The review caught it, but only because a sampled frame showed it clearly.
5. **Turn on prompt caching** for the system prompt and ad context shared by plan, review and fix. This is not measured yet; input is about a third of cost.
6. **Keep direct mode behind a flag** until the conditions in section 8 are met.

## Problems seen
- The SDK, structured-output and revise bugs in section 5.
- Hyperframes falls back to slower screenshot capture with software GL ("BeginFrame did not run") on some renders. Its output is kept only on failure, so this run did not check for it.
- The auto-mode permission classifier refused several steps in the first session: building FFmpeg from source, running the downloaded binaries at times, and setting a temporary password for the asset download. The user supplied the clips instead.
- Claude Code cloud environments reserve `ANTHROPIC_API_KEY` and strip it from the session. The proof reads `PROOF_ANTHROPIC_API_KEY` first, then `ANTHROPIC_API_KEY`.
- The container sets `ANTHROPIC_BASE_URL` for Claude Code's own traffic. The proof pins `https://api.anthropic.com` explicitly (override with `PROOF_ANTHROPIC_BASE_URL`).

## Reproduce
```sh
labs/concat-proof/setup.sh                               # toolchain, about 3.5 min
cd labs/concat-proof && npm install --ignore-scripts
# put the 6 scene clips (01.mp4 .. 06.mp4) in a folder, e.g. /home/user/work/ad
AD_MEDIA_DIR=/home/user/work/ad node src/test-alpha.mjs /home/user/work/alpha /home/user/work/ad/01.mp4 <dir with hook.mov/.webm/.png/.mp4>
AD_MEDIA_DIR=/home/user/work/ad node src/run.mjs --mode template --plan fixtures/executor-test-plan.json   # executor test, no Claude
AD_MEDIA_DIR=/home/user/work/ad PROOF_ANTHROPIC_API_KEY=... node src/run.mjs --mode template                       # Claude-directed
AD_MEDIA_DIR=/home/user/work/ad PROOF_ANTHROPIC_API_KEY=... node src/run.mjs --mode direct
AD_MEDIA_DIR=/home/user/work/ad PROOF_ANTHROPIC_API_KEY=... node src/run.mjs --mode template \
  --revise "make it punchier" --from /home/user/work/edit-template/final-plan.json --work /home/user/work/edit-template-revise
AD_MEDIA_DIR=/home/user/work/ad node src/run.mjs --mode template --plan results/template/final-plan.json --no-review # re-render, no Claude
```

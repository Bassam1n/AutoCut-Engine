# Concat + Hyperframes proof: interim report

Status: **goals 1 and 2 done, goal 3 machinery done, Claude-directed run pending.**
- Concat builds from source and is driven only through its JSON-RPC API.
- Transparency is settled.
- The full plan → graphics → Concat → preview → final pipeline runs on the real ad's six clips, using a hand-written test plan.
- The Claude planning, review and revise calls are written but have not run: the Anthropic key was added after this session started, and a session only sees environment changes made before it starts.

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
6. A 540x960 preview is rendered. Up to 16 frames are sampled at clip midpoints, captions and graphics, and Claude reviews them and returns a verdict, issues and a revised plan.
7. The final 1080x1920 MP4 is rendered.

`--revise "make it punchier" --from final-plan.json` is the later chat turn. It rewrites the same plan format.

Two modes share the plan; only the graphics differ:
- `--mode template`: Claude picks one of three templates (hookPill, callout, endCard) and writes its text and colours.
- `--mode direct`: Claude writes each motion graphic itself as CSS, HTML and GSAP timeline code. Captions, trims, transitions and zooms are Claude's in both modes.

The ad: the demo org's cold brew ad, 6 scenes. The clips came from the user as 720x1280 at 24 fps, 4.0 to 6.0 s each. There is **no voiceover**, so captions carry the script and their timing comes from the scene copy and durations.

Executor test with a hand-written plan (`fixtures/executor-test-plan.json`, not Claude output; it checks the machinery):
- Output: 30.0 s, 1080x1920, 30 fps, H.264 + AAC.
- Contents: six trimmed clips, one cross-fade, two Ken Burns moves, 8 captions, a ProRes hook overlay, and a full-frame end card.
- All of it renders correctly (frames checked visually).

## 4. Measurements so far (4 vCPU, no GPU, lavapipe)
| Step | Time |
|---|---|
| Concat build (release, cold) | about 3 min |
| Hyperframes graphic, 2.5 s overlay → ProRes 4444 | 17.6 s |
| Hyperframes graphic, 3.3 s full-frame → MP4 | 9.9 s |
| Hyperframes 3 s overlay (first test, .mov / .webm) | 24.3 s / 24.1 s |
| Concat project build via API (about 60 calls) | 0.4 s |
| Concat preview export, 30 s at 540x960, crf 30 veryfast | 32.7 s |
| Concat final export, 30 s at 1080x1920, crf 20 medium | 122 s (about 4x real time) |

Claude tokens and cost per edit are pending the run with the key.

## Problems seen
- Hyperframes falls back to slower screenshot capture with software GL ("BeginFrame did not run") on some renders.
- The auto-mode permission classifier refused several steps: building FFmpeg from source, running the downloaded binaries at times, and setting a temporary password for the asset download. The user supplied the clips instead.
- Claude Code cloud environments reserve `ANTHROPIC_API_KEY` and strip it from the session ("won't be used to authenticate requests"). The proof reads `PROOF_ANTHROPIC_API_KEY` first, then `ANTHROPIC_API_KEY`.
- The container sets `ANTHROPIC_BASE_URL` for Claude Code's own traffic. The proof pins `https://api.anthropic.com` explicitly (override with `PROOF_ANTHROPIC_BASE_URL`).

## Reproduce
```sh
labs/concat-proof/setup.sh                               # toolchain, about 5 min
cd labs/concat-proof && npm install --ignore-scripts
# put the 6 scene clips (01.mp4 .. 06.mp4) in a folder, e.g. /home/user/work/ad
AD_MEDIA_DIR=/home/user/work/ad node src/test-alpha.mjs /home/user/work/alpha /home/user/work/ad/01.mp4 <dir with hook.mov/.webm/.png/.mp4>
AD_MEDIA_DIR=/home/user/work/ad node src/run.mjs --mode template --plan fixtures/executor-test-plan.json   # executor test, no Claude
AD_MEDIA_DIR=/home/user/work/ad PROOF_ANTHROPIC_API_KEY=... node src/run.mjs --mode template                       # Claude-directed
AD_MEDIA_DIR=/home/user/work/ad PROOF_ANTHROPIC_API_KEY=... node src/run.mjs --mode direct
```

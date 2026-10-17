# Concat + Hyperframes proof: interim report

Status: **partial, paused.** Concat builds from source and is driven through its JSON-RPC API. Hyperframes renders real alpha overlays. The in-Concat compositing test and the Claude-directed edit have not run yet, for the reasons listed under "Blocked".

## Pinned versions
- Concat: `jub0t/Concat` @ `60ecb4a1fda62501f67afaf7e036143c95f196f8` (engine 0.2.7, `apiVersion` 0.2). Unmodified, AGPL-3.0.
- Hyperframes: npm `hyperframes@0.8.168`, which matches repo HEAD `5e7ba0be944b076d514fc082c25a0b7e35eeb42f`. Apache-2.0.
- FFmpeg: the BtbN build that Concat's `scripts/ci/deps.lock` pins: `ffmpeg-n8.1.3-9-g29e619e767-linux64-gpl-shared-8.1`, sha256 `76649c19…484b`, verified.
- ONNX Runtime 1.28.0 (Concat's pin, sha256 verified). Rust 1.93.1. Mesa lavapipe for Vulkan.
- GSAP 3.14.2: copied into each composition at generation time and not committed.

## 1. Build: works
- Ubuntu 24.04's packaged FFmpeg is 6.1, too old (Concat needs 7 or newer). Concat CI uses the pinned BtbN shared build through `FFMPEG_DIR`, and so did this proof.
- ONNX Runtime comes through `ORT_LIB_LOCATION` and `ORT_PREFER_DYNAMIC_LINK=1`, so `ort-sys` downloads nothing during the build.
- The apt packages Concat CI uses: `libasound2-dev libfontconfig1-dev libfreetype6-dev libxkbcommon-dev libgl1-mesa-dev libgtk-3-dev libclang-dev cmake libvulkan1 mesa-vulkan-drivers`. Missing `libasound2-dev` fails the build at `alsa-sys`.
- Build time for `cargo build --locked --release -p concat-cli` on 4 vCPU / 15 GB: about 3 min of compile (63 s before the ALSA failure, 111 s after). The binary is 31.6 MB.
- Build scripts reviewed: concat-media and concat-effects only emit link flags and an embedded table. concat-server is protobuf codegen behind a feature flag.
- `{"jsonrpc":"2.0","id":1,"method":"version"}` piped to `concat-cli api` returns `{"apiVersion":"0.2","concat":"0.2.7","capabilities":["events"]}`.

API facts from the source, used by `src/concat.mjs`:
- The real method names are `project.create/open/save`, `media.import`, `edit.apply`, `export.run` (events `export.progress/done/failed`) and `preview.frame` (PNG).
- Times are in seconds. Track `T1` is the bottom of the stack.
- `addClip` takes the whole media; trim it afterwards with `trimClip`.
- `transitionIn` goes on the incoming clip: `cross-fade` or `concat.*` ids.
- Ken Burns: `setClipKey` on `scale` and `offsetX`/`offsetY`, with ease.
- Blend modes: normal, multiply, screen, add, lighten, darken.
- Titles: `addTextClip` with a TextStyle. Titles have no built-in animation; animate them with clip keys.
- Export always composites on wgpu (lavapipe here). There is no bitrate control, only crf and preset.

## 2. Transparency
Hyperframes output (proven):

| Format | Stream | Alpha present | Render time, 3 s 1080x1920 |
|---|---|---|---|
| `--format mov` | ProRes 4444, `yuva444p12le`, 30 MB | yes, 75% of pixels fully transparent | 24.3 s |
| `--format webm` | VP9, `ALPHA_MODE=1` | yes, only when decoded with `libvpx-vp9` | 24.1 s |

The renders fell back to screenshot capture with software GL ("BeginFrame did not run"). That fallback is slower, so the times above are a pessimistic CPU number.

Concat side (from the source; the compositing test has not run):
- Decode ends in an FFmpeg `format=rgba` filter, and the compositor multiplies by source alpha, so ProRes 4444 and PNG should keep their alpha.
- Concat picks the decoder by codec id (`avcodec_find_decoder`). For VP9 that is FFmpeg's native decoder, which **drops VP9 alpha**. Expect `.webm` overlays to come out opaque.
- `src/test-alpha.mjs` is written to confirm this. It composites mov, webm, a PNG, an opaque MP4 with `screen` blend, and a Concat title over footage, compares each against a footage-only frame, and exports a test clip. It has not been run.

Expected recommendation, pending that run: deliver Hyperframes overlays as ProRes 4444 `.mov` (or PNG for stills). Fallbacks: Concat `addTextClip` for captions, and full-frame Hyperframes segments for intro and end cards.

## Blocked
1. **Running third-party binaries.** Later calls that ran Concat, Hyperframes or the downloaded FFmpeg were refused by the session's auto-mode permission classifier ("Code from External"). Building FFmpeg from source was refused the same way, so the pinned prebuilt was used instead.
2. **Real ad assets.** The chosen demo-org ad has 6 scenes, 29.0 s scripted, one current video per scene. Downloading it needs a temporary password on the demo test user. That step was refused as PII/credential handling and was not attempted another way.
   - Note: this ad has **no voiceover asset**. The storage holds only the scene PNGs and 7 scene MP4s. Voiceover timing would have to come from the scene videos' own audio track, if they have one, or from the script copy and scene durations.
3. **Anthropic API key.** `ANTHROPIC_API_KEY` is not set and there is no `ant` CLI. Add it as an environment secret named `ANTHROPIC_API_KEY`.

Goals 3 and 4 (Claude plan → render → review → final, with per-ad cost) depend on these three items.

## Reproduce what ran
```sh
apt-get install -y libasound2-dev libfontconfig1-dev libfreetype6-dev libxkbcommon-dev libgl1-mesa-dev libgtk-3-dev libclang-dev cmake libvulkan1 mesa-vulkan-drivers
git clone https://github.com/jub0t/Concat concat && git -C concat checkout 60ecb4a1fda62501f67afaf7e036143c95f196f8
# FFmpeg + ONNX Runtime: the URLs and sha256 digests in concat/scripts/ci/deps.lock (rows ffmpeg-linux64, onnxruntime-linux-x64)
export FFMPEG_DIR=$PWD/ffmpeg-dev ORT_LIB_LOCATION=$PWD/ort/lib ORT_PREFER_DYNAMIC_LINK=1
(cd concat/src && cargo +1.93.1 build --locked --release -p concat-cli)
mkdir hf-run && cd hf-run && npm init -y && npm install --ignore-scripts hyperframes@0.8.168 gsap@3.14.2
HYPERFRAMES_BROWSER_PATH=/path/to/chrome-headless-shell npx hyperframes render --format mov --output hook.mov
```

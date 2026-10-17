import { existsSync } from "node:fs";

/**
 * The render toolchain the Auto-edit worker runs, pinned. The worker
 * image (trigger.config.ts) installs everything below under
 * AUTO_EDIT_ROOT; locally, set AUTO_EDIT_ROOT (or the individual path
 * variables) to a directory laid out the same way.
 *
 * - concat-cli: the Concat video engine, unmodified (AGPL-3.0), built by
 *   .github/workflows/concat-cli-release.yml and downloaded from this
 *   repo's release. Its LICENSE, TRADEMARK.md and SOURCE.txt sit next to
 *   the binary in the image.
 * - FFmpeg 8.1 (BtbN shared build) and ONNX Runtime 1.28: Concat's own
 *   pins from its scripts/ci/deps.lock.
 * - Hyperframes (Apache-2.0) + GSAP for motion graphics, with the exact
 *   chrome-headless-shell build Hyperframes manages.
 */
export const TOOLCHAIN = {
  concat: {
    commit: "60ecb4a1fda62501f67afaf7e036143c95f196f8",
    releaseTag: "concat-cli-60ecb4a",
    asset: "concat-cli-linux-x64.tar.gz",
    sha256: "f13670086e97021fc0535b6eb163c3e80d90438164e360738d5bf2a6d1561e23",
  },
  ffmpeg: {
    url: "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-09-30-13-08/ffmpeg-n8.1.3-9-g29e619e767-linux64-gpl-shared-8.1.tar.xz",
    sha256: "76649c19a7a4615b367251ba4a8adc643f65831278a00e7a0c38398f7f06484b",
  },
  onnxruntime: {
    url: "https://github.com/microsoft/onnxruntime/releases/download/v1.28.0/onnxruntime-linux-x64-1.28.0.tgz",
    sha256: "a3e1b79d7bb1bf09696ce675f49e4064e6c81f6202b8225624fff0e93f8d6407",
  },
  hyperframes: "0.8.168",
  gsap: "3.14.2",
  chromeHeadlessShell: "152.0.7977.30",
} as const;

export const RELEASE_REPO = "Bassam1n/AutoCut-Engine";

/**
 * Extra flags for the Chromium that renders graphics: every request
 * that isn't to the local Hyperframes server goes to a dead proxy, and
 * DNS resolves nothing but localhost. Claude-written graphics therefore
 * can't reach the network even if they get past checkGraphicCode().
 */
export const CHROME_SANDBOX_FLAGS = [
  "--proxy-server=http://127.0.0.1:9",
  '--host-resolver-rules="MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1"',
  "--webrtc-ip-handling-policy=disable_non_proxied_udp",
  "--force-webrtc-ip-handling-policy",
];

// Mesa's software Vulkan driver (lavapipe): the engine composites on
// wgpu and there is no GPU. Debian names the file per architecture.
const LAVAPIPE_ICDS = ["/usr/share/vulkan/icd.d/lvp_icd.x86_64.json", "/usr/share/vulkan/icd.d/lvp_icd.json"];

export type ToolchainPaths = {
  concatBin: string;
  concatEnv: NodeJS.ProcessEnv;
  hyperframesBin: string;
  hyperframesEnv: NodeJS.ProcessEnv;
  gsapJs: string;
  ffmpeg: string;
  ffprobe: string;
  interFont: string;
};

export function toolchainPaths(env: NodeJS.ProcessEnv = process.env): ToolchainPaths {
  const root = env.AUTO_EDIT_ROOT ?? "/opt/autoedit";
  const ffLib = `${root}/ffmpeg/lib`;
  const ortLib = `${root}/onnxruntime/lib`;
  // The worker sets no HOME, and the engine refuses to start without
  // one (it keeps its settings there).
  const home = env.AUTO_EDIT_HOME ?? env.HOME ?? "/tmp";
  const base: NodeJS.ProcessEnv = { ...env, HOME: home };
  // Never hand the render tools the app's secrets.
  for (const k of Object.keys(base)) {
    if (/KEY|SECRET|TOKEN|PASSWORD/i.test(k)) delete base[k];
  }
  return {
    concatBin: env.CONCAT_BIN ?? `${root}/concat-cli/concat-cli`,
    concatEnv: {
      ...base,
      LD_LIBRARY_PATH: [ffLib, ortLib, env.LD_LIBRARY_PATH].filter(Boolean).join(":"),
      VK_ICD_FILENAMES: env.VK_ICD_FILENAMES ?? LAVAPIPE_ICDS.find((f) => existsSync(f)) ?? LAVAPIPE_ICDS[0],
    },
    hyperframesBin: env.HYPERFRAMES_BIN ?? `${root}/hf/node_modules/.bin/hyperframes`,
    hyperframesEnv: {
      ...base,
      // The sandboxed browser wrapper (see CHROME_SANDBOX_FLAGS).
      HYPERFRAMES_BROWSER_PATH: env.AUTO_EDIT_CHROME ?? `${root}/chrome-sandboxed`,
      PRODUCER_HEADLESS_SHELL_PATH: env.AUTO_EDIT_CHROME ?? `${root}/chrome-sandboxed`,
      PATH: `${root}/ffmpeg/bin:${env.PATH ?? ""}`,
      LD_LIBRARY_PATH: ffLib,
      DO_NOT_TRACK: "1",
      HYPERFRAMES_NO_TELEMETRY: "1",
      HYPERFRAMES_NO_UPDATE_CHECK: "1",
      HYPERFRAMES_SKIP_SKILLS: "1",
    },
    gsapJs: env.GSAP_JS ?? `${root}/hf/node_modules/gsap/dist/gsap.min.js`,
    ffmpeg: env.FFMPEG_BIN ?? `${root}/ffmpeg/bin/ffmpeg`,
    ffprobe: env.FFPROBE_BIN ?? `${root}/ffmpeg/bin/ffprobe`,
    interFont: env.INTER_FONT ?? "/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf",
  };
}

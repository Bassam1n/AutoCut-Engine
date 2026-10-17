// Where the third-party tools live. Override with env vars; defaults match REPORT.md's setup steps.
const TP = process.env.THIRDPARTY_DIR ?? "/home/user/thirdparty";
const ffLib = process.env.FFMPEG_DIR ? `${process.env.FFMPEG_DIR}/lib` : `${TP}/ffmpeg-dev/lib`;
const ortLib = process.env.ORT_LIB_LOCATION ?? `${TP}/ort/onnxruntime-linux-x64-1.28.0/lib`;

export const env = {
  concatBin: process.env.CONCAT_BIN ?? `${TP}/concat/src/target/release/concat-cli`,
  concatCwd: process.env.CONCAT_CWD ?? `${TP}/concat/src`,
  concatEnv: {
    ...process.env,
    LD_LIBRARY_PATH: `${ffLib}:${ortLib}`,
    VK_ICD_FILENAMES: process.env.VK_ICD_FILENAMES ?? "/usr/share/vulkan/icd.d/lvp_icd.json",
  },
  hfBin: process.env.HYPERFRAMES_BIN ?? `${TP}/hf-run/node_modules/.bin/hyperframes`,
  hfCwdRoot: process.env.HYPERFRAMES_WORK ?? "/home/user/work/hf",
  gsap: process.env.GSAP_JS ?? `${TP}/hf-run/node_modules/gsap/dist/gsap.min.js`,
  hfEnv: {
    ...process.env,
    HYPERFRAMES_BROWSER_PATH: process.env.HYPERFRAMES_BROWSER_PATH ?? "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
    PATH: `${TP}/ffmpeg-dev/bin:${process.env.PATH}`,
    LD_LIBRARY_PATH: ffLib,
    DO_NOT_TRACK: "1",
    HYPERFRAMES_NO_TELEMETRY: "1",
  },
  ffmpeg: `${TP}/ffmpeg-dev/bin/ffmpeg`,
  ffprobe: `${TP}/ffmpeg-dev/bin/ffprobe`,
};

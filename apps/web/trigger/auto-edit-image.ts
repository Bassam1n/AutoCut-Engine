import type { BuildExtension } from "@trigger.dev/build";
import { CHROME_SANDBOX_FLAGS, RELEASE_REPO, TOOLCHAIN } from "../src/lib/auto-edit/toolchain";

/**
 * Build extensions that put Auto-edit's render toolchain into the
 * Trigger.dev worker image, under /opt/autoedit (lib/auto-edit/
 * toolchain.ts reads it from there). Each download is checked against
 * a pinned sha256; nothing is compiled during the build.
 *
 * Layer image instructions run as root in the image's base stage, before
 * the aptGet packages are installed, so they fetch their own download
 * tools. Verified against the trigger.dev v4.7.3 CLI's Containerfile
 * generator (deploy/buildImage.js) and the custom build extension docs.
 */

const ROOT = "/opt/autoedit";

function fetchChecked(url: string, sha256: string, out: string): string {
  return `curl -fsSL --retry 3 -o ${out} "${url}" && echo "${sha256}  ${out}" | sha256sum -c -`;
}

/** The render engine (a prebuilt concat-cli from this repo's release) plus its FFmpeg 8.1 and ONNX Runtime 1.28 pins. */
export function autoEditEngine(): BuildExtension {
  return {
    name: "auto-edit-engine",
    onBuildComplete(context) {
      if (context.target === "dev") return;
      const c = TOOLCHAIN.concat;
      const concatUrl = `https://github.com/${RELEASE_REPO}/releases/download/${c.releaseTag}/${c.asset}`;
      context.addLayer({
        id: "auto-edit-engine",
        image: {
          instructions: [
            `RUN set -eux; \\
  apt-get update; apt-get install -y --no-install-recommends curl ca-certificates xz-utils; \\
  mkdir -p ${ROOT}/ffmpeg ${ROOT}/onnxruntime; cd /tmp; \\
  ${fetchChecked(TOOLCHAIN.ffmpeg.url, TOOLCHAIN.ffmpeg.sha256, "ffmpeg.tar.xz")}; \\
  tar -xf ffmpeg.tar.xz -C ${ROOT}/ffmpeg --strip-components=1; \\
  ${fetchChecked(TOOLCHAIN.onnxruntime.url, TOOLCHAIN.onnxruntime.sha256, "ort.tgz")}; \\
  tar -xzf ort.tgz -C ${ROOT}/onnxruntime --strip-components=1; \\
  ln -sf libonnxruntime.so.1.28.0 ${ROOT}/onnxruntime/lib/libonnxruntime.so; \\
  ${fetchChecked(concatUrl, c.sha256, "concat-cli.tar.gz")}; \\
  tar -xzf concat-cli.tar.gz -C ${ROOT}; \\
  rm -rf /tmp/ffmpeg.tar.xz /tmp/ort.tgz /tmp/concat-cli.tar.gz ${ROOT}/ffmpeg/include ${ROOT}/ffmpeg/doc; \\
  apt-get clean; rm -rf /var/lib/apt/lists/*; \\
  LD_LIBRARY_PATH=${ROOT}/ffmpeg/lib:${ROOT}/onnxruntime/lib ${ROOT}/concat-cli/concat-cli --version`,
          ],
        },
      });
    },
  };
}

/**
 * Hyperframes and GSAP for motion graphics, the exact chrome-headless-shell
 * build Hyperframes manages, and the sandbox wrapper the renderer starts
 * instead of Chromium: it adds flags that refuse every non-loopback
 * request, so Claude-written graphics can't reach the network.
 */
export function hyperframesChromium(): BuildExtension {
  return {
    name: "hyperframes-chromium",
    onBuildComplete(context) {
      if (context.target === "dev") return;
      const chrome = `${ROOT}/chrome/chrome-headless-shell/linux-${TOOLCHAIN.chromeHeadlessShell}/chrome-headless-shell-linux64/chrome-headless-shell`;
      const wrapper = `#!/bin/sh\\nexec ${chrome} \\"\\$@\\" ${CHROME_SANDBOX_FLAGS.map((f) => f.replace(/"/g, '\\"')).join(" ")}\\n`;
      context.addLayer({
        id: "hyperframes-chromium",
        image: {
          instructions: [
            `RUN set -eux; \\
  mkdir -p ${ROOT}/hf ${ROOT}/chrome; cd ${ROOT}/hf; \\
  printf '{"name":"auto-edit-hf","private":true}\\n' > package.json; \\
  npm install --omit=dev --ignore-scripts --no-audit --no-fund --no-update-notifier hyperframes@${TOOLCHAIN.hyperframes} gsap@${TOOLCHAIN.gsap}; \\
  node ${ROOT}/hf/node_modules/@puppeteer/browsers/lib/main-cli.js install chrome-headless-shell@${TOOLCHAIN.chromeHeadlessShell} --path ${ROOT}/chrome; \\
  printf "${wrapper}" > ${ROOT}/chrome-sandboxed; chmod 755 ${ROOT}/chrome-sandboxed; \\
  cat ${ROOT}/chrome-sandboxed; npm cache clean --force`,
          ],
        },
      });
    },
  };
}

/** Runtime libraries: software Vulkan for the engine's compositor, Chromium's shared libraries, fonts and ALSA. */
export const AUTO_EDIT_APT_PACKAGES = [
  "mesa-vulkan-drivers", "libvulkan1",
  "fonts-inter", "fonts-dejavu-core", "fontconfig",
  "libasound2",
  "libnss3", "libnspr4", "libatk1.0-0", "libatk-bridge2.0-0", "libcups2", "libdrm2", "libxkbcommon0",
  "libxcomposite1", "libxdamage1", "libxfixes3", "libxrandr2", "libgbm1", "libpango-1.0-0", "libcairo2",
  "libxshmfence1", "libdbus-1-3", "libx11-6", "libxcb1", "libxext6", "libexpat1",
];

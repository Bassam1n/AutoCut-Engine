#!/usr/bin/env bash
# Rebuilds the proof's toolchain in a fresh Ubuntu 24.04 container (about 5 min on 4 vCPU).
# Third-party code goes to $THIRDPARTY_DIR (default /home/user/thirdparty), outside this repo.
# Prebuilt FFmpeg and ONNX Runtime are Concat's own pins (scripts/ci/deps.lock), digest-checked.
set -euo pipefail
TP=${THIRDPARTY_DIR:-/home/user/thirdparty}
CONCAT_COMMIT=60ecb4a1fda62501f67afaf7e036143c95f196f8
HF_VERSION=0.8.168
FF_URL=https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-09-30-13-08/ffmpeg-n8.1.3-9-g29e619e767-linux64-gpl-shared-8.1.tar.xz
FF_SHA=76649c19a7a4615b367251ba4a8adc643f65831278a00e7a0c38398f7f06484b
ORT_URL=https://github.com/microsoft/onnxruntime/releases/download/v1.28.0/onnxruntime-linux-x64-1.28.0.tgz
ORT_SHA=a3e1b79d7bb1bf09696ce675f49e4064e6c81f6202b8225624fff0e93f8d6407

mkdir -p "$TP"
apt-get update -q
apt-get install -y -q --no-install-recommends libasound2-dev libfontconfig1-dev libfreetype6-dev libxkbcommon-dev \
  libgl1-mesa-dev libgtk-3-dev libclang-dev clang cmake pkg-config libvulkan1 mesa-vulkan-drivers fonts-inter python3-pil

fetch() { # url sha out
  [ -f "$3" ] && echo "$2  $3" | sha256sum -c --quiet && return
  curl -sSL -o "$3" "$1" && echo "$2  $3" | sha256sum -c
}
fetch "$FF_URL" "$FF_SHA" "$TP/ffmpeg.tar.xz"
mkdir -p "$TP/ffmpeg-dev" && tar -xf "$TP/ffmpeg.tar.xz" -C "$TP/ffmpeg-dev" --strip-components=1
fetch "$ORT_URL" "$ORT_SHA" "$TP/ort.tgz"
mkdir -p "$TP/ort" && tar -xzf "$TP/ort.tgz" -C "$TP/ort"
ln -sf libonnxruntime.so.1.28.0 "$TP/ort/onnxruntime-linux-x64-1.28.0/lib/libonnxruntime.so"

[ -d "$TP/concat/.git" ] || git clone -q https://github.com/jub0t/Concat "$TP/concat"
git -C "$TP/concat" checkout -q "$CONCAT_COMMIT"
rustup toolchain install 1.93.1 --profile minimal
( cd "$TP/concat/src" &&
  FFMPEG_DIR="$TP/ffmpeg-dev" ORT_LIB_LOCATION="$TP/ort/onnxruntime-linux-x64-1.28.0/lib" ORT_PREFER_DYNAMIC_LINK=1 \
  cargo +1.93.1 build --locked --release -p concat-cli )

mkdir -p "$TP/hf-run" && cd "$TP/hf-run"
[ -f package.json ] || npm init -y >/dev/null
npm install --ignore-scripts "hyperframes@$HF_VERSION" gsap@3.14.2
echo "Toolchain ready in $TP"

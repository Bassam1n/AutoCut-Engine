"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { documentFor, resolveGraphic } from "@/lib/auto-edit/graphics-sandbox";
import type { EditPlan, PlanGraphic } from "@/lib/auto-edit/plan-schema";
import type { PreviewState } from "@/lib/auto-edit/preview-model";
import type { EditorScene } from "../auto-edit-actions";

/**
 * The timeline played in the browser, no render: the scene videos, the
 * voiceover, captions and motion graphics in sync, driven by the
 * editor's playhead. Every edit shows at once and costs nothing.
 *
 * Graphics run in iframes sandboxed to scripts only (no same origin, no
 * forms, popups or navigation of the page), from a srcdoc with GSAP and
 * Inter inlined and a Content-Security-Policy that refuses every
 * connection, so Claude-written Designed code can't reach the network.
 * A graphic whose code fails the sandbox checks shows its Clean
 * template, as in the render.
 */

const W = 1080;
const H = 1920;

let vendor: Promise<{ gsap: string; inter: string }> | null = null;
function loadVendor() {
  vendor ??= Promise.all([
    fetch("/vendor/gsap-3.14.2.min.js").then((r) => r.text()),
    fetch("/vendor/InterVariable-4.1.woff2")
      .then((r) => r.blob())
      .then((b) => new Promise<string>((res) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result));
        fr.readAsDataURL(b);
      })),
  ]).then(([gsap, inter]) => ({ gsap, inter: inter.replace(/^data:[^;]*;/, "data:font/woff2;") }));
  return vendor;
}

export function LivePreview({
  plan,
  scenes,
  state,
  playing,
  width,
  onMediaDuration,
}: {
  plan: EditPlan;
  scenes: EditorScene[];
  state: PreviewState;
  playing: boolean;
  width: number;
  onMediaDuration?: (kind: "video" | "voiceover", scene: number, seconds: number) => void;
}) {
  const scale = width / W;
  const height = (width * H) / W;
  const videos = useRef(new Map<number, HTMLVideoElement>());
  const audios = useRef(new Map<number, HTMLAudioElement>());
  const sceneUrl = (i: number) => scenes.find((s) => s.index === i)?.videoUrl ?? null;

  // Keep each clip's video and each voiceover at the playhead.
  useEffect(() => {
    const active = new Map(state.clips.map((c) => [c.index, c]));
    for (const [i, v] of videos.current) {
      const c = active.get(i);
      if (!c) {
        if (!v.paused) v.pause();
        continue;
      }
      v.volume = Math.max(0, Math.min(1, c.volume));
      v.muted = !playing;
      sync(v, c.sourceTime, playing);
    }
    const sounding = new Map(state.voiceovers.map((a) => [a.scene, a.local]));
    for (const [scene, a] of audios.current) {
      const local = sounding.get(scene);
      if (local == null) {
        if (!a.paused) a.pause();
        continue;
      }
      sync(a, local, playing);
    }
  }, [state, playing]);

  const visible = new Map(state.clips.map((c) => [c.index, c]));
  const shownGraphics = new Map(state.graphics.map((g) => [g.id, g.local]));
  const separateVo = scenes.filter((s) => s.voiceoverUrl && s.voiceoverMode === "separate");

  return (
    <div className="relative overflow-hidden rounded-lg bg-black" style={{ width, height }}>
      {plan.clips.map((c, i) => {
        const v = visible.get(i);
        const url = sceneUrl(c.scene);
        if (!url) return null;
        return (
          <video
            key={`${i}:${c.scene}`}
            ref={(el) => {
              if (el) videos.current.set(i, el);
              else videos.current.delete(i);
            }}
            src={url}
            preload="auto"
            playsInline
            muted
            onLoadedMetadata={(e) => onMediaDuration?.("video", c.scene, e.currentTarget.duration)}
            className="absolute inset-0 h-full w-full object-cover"
            style={{
              opacity: v ? v.opacity : 0,
              zIndex: v ? 1 + i : 0,
              transform: v ? `translate(${v.offsetX * 100}%, ${v.offsetY * 100}%) scale(${v.scale})` : undefined,
            }}
          />
        );
      })}

      {plan.graphics.map((g) => (
        <GraphicFrame key={g.id} graphic={g} local={shownGraphics.get(g.id)} scale={scale} />
      ))}

      {state.captions.map((ci) => {
        const c = plan.captions[ci];
        const st = plan.captionStyles.find((s) => s.name === c.style) ?? plan.captionStyles[0];
        if (!st) return null;
        const age = state.t - c.start;
        const pop = c.popIn && age < 0.12 ? 0.85 + (0.15 * age) / 0.12 : 1;
        return (
          <div
            key={ci}
            className="pointer-events-none absolute left-1/2 text-center"
            style={{
              top: height / 2 + st.offsetY * height,
              width: st.maxWidth * width,
              transform: `translate(-50%, -50%) scale(${pop})`,
              zIndex: 60,
              fontFamily: "AutoCutInter, Inter, sans-serif",
              fontSize: st.fontSize * height,
              fontWeight: st.fontWeight,
              lineHeight: 1.15,
              color: st.color,
              WebkitTextStroke: st.strokeWidth ? `${st.strokeWidth * height}px ${st.strokeColor}` : undefined,
              paintOrder: "stroke fill",
              textShadow: st.background ? undefined : "0 2px 8px rgba(0,0,0,.7)",
            }}
          >
            <span style={{ background: st.background || undefined, padding: st.background ? `${0.15 * st.fontSize * height}px ${0.35 * st.fontSize * height}px` : undefined, borderRadius: 6, boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone" }}>
              {c.text}
            </span>
          </div>
        );
      })}

      {separateVo.map((s) => (
        <audio
          key={s.index}
          ref={(el) => {
            if (el) audios.current.set(s.index, el);
            else audios.current.delete(s.index);
          }}
          src={s.voiceoverUrl!}
          preload="auto"
          onLoadedMetadata={(e) => onMediaDuration?.("voiceover", s.index, e.currentTarget.duration)}
        />
      ))}
      <style>{`@font-face { font-family: AutoCutInter; src: url(/vendor/InterVariable-4.1.woff2) format("woff2"); font-weight: 100 900; }`}</style>
    </div>
  );
}

function sync(el: HTMLMediaElement, target: number, playing: boolean) {
  const drift = Math.abs(el.currentTime - target);
  if (playing) {
    if (el.paused) {
      el.currentTime = target;
      void el.play().catch(() => {});
    } else if (drift > 0.3) {
      el.currentTime = target;
    }
  } else {
    if (!el.paused) el.pause();
    if (drift > 0.04) el.currentTime = target;
  }
}

/** One motion graphic in its sandboxed iframe, seeked to the playhead. */
const GraphicFrame = memo(function GraphicFrame({ graphic, local, scale }: { graphic: PlanGraphic; local: number | undefined; scale: number }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [assets, setAssets] = useState<{ gsap: string; inter: string } | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    void loadVendor().then((v) => live && setAssets(v));
    return () => {
      live = false;
    };
  }, []);
  // Rebuilt only when the graphic's own code, template text or length changes.
  const key = JSON.stringify([graphic.code, graphic.template, graphic.duration, graphic.layout]);
  const srcDoc = useMemo(() => {
    if (!assets) return null;
    const { code } = resolveGraphic(graphic);
    return documentFor(graphic.id.replace(/[^a-z0-9-]/gi, "-"), graphic.duration, code, graphic.layout === "fullFrame", {
      gsap: assets.gsap,
      interWoff2DataUrl: assets.inter,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the parts that change the document
  }, [assets, key]);

  useEffect(() => {
    if (ready && local != null) frame.current?.contentWindow?.postMessage({ type: "seek", t: local }, "*");
  }, [local, ready]);

  if (!srcDoc) return null;
  return (
    <iframe
      ref={frame}
      title={`graphic ${graphic.id}`}
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      onLoad={() => setReady(true)}
      className="pointer-events-none absolute left-0 top-0 border-0"
      style={{
        width: W,
        height: H,
        transform: `scale(${scale})`,
        transformOrigin: "0 0",
        visibility: local == null ? "hidden" : "visible",
        zIndex: graphic.layout === "fullFrame" ? 80 : 50,
        background: "transparent",
        colorScheme: "normal",
      }}
    />
  );
});

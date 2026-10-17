import { describe, expect, it, vi } from "vitest";
import designedFixture from "./__fixtures__/designed-plan.json";
import { renderPlanGraphics, type RenderOne } from "./graphics-render";
import { checkGraphicCode, documentFor, resolveGraphic, templateCode } from "./graphics-sandbox";
import { EditPlan } from "./plan-schema";

const designed = () => EditPlan.parse(structuredClone(designedFixture));
const ok = { css: "#a{color:#fff}", html: '<div id="a">Hi</div>', js: 'tl.to("#a",{opacity:1,duration:.3},0);' };

describe("checkGraphicCode (designed-mode sandbox)", () => {
  it("accepts plain GSAP graphics", () => {
    expect(checkGraphicCode(ok)).toEqual([]);
  });

  it.each([
    ["js", 'fetch("https://evil.example/x")', "network access"],
    ["js", "new WebSocket('wss://x')", "network access"],
    ["js", "setTimeout(go, 10)", "timers"],
    ["js", "var r = Math.random()", "deterministic"],
    ["js", "location.href = 'https://x'", "browser state"],
    ["js", "eval('1')", "eval"],
    ["js", "</script><script>alert(1)", "closing the script tag"],
    ["html", '<img src="https://x/y.png">', "disallowed element"],
    ["html", '<div onclick="go()">x</div>', "inline event handler"],
    ["html", '<a href="javascript:go()">x</a>', "remote or script URL"],
    ["css", "@import url(https://x/a.css);", "@import"],
    ["css", "#a{background:url(https://x/y.png)}", "url() other than data:"],
    ["css", "</style><script>x</script>", "markup in CSS"],
  ])("refuses %s: %s", (part, src, why) => {
    const problems = checkGraphicCode({ ...ok, [part]: src });
    expect(problems.join(" | ")).toContain(why);
  });

  it("caps the code size", () => {
    expect(checkGraphicCode({ ...ok, css: "a{}".repeat(5000) })).toContainEqual(expect.stringContaining("over the 12000 cap"));
  });

  it("puts a no-connections Content-Security-Policy in every document", () => {
    const doc = documentFor("g", 2, ok, false);
    expect(doc).toContain("connect-src 'self'");
    expect(doc).toContain("default-src 'none'");
    expect(doc.indexOf("Content-Security-Policy")).toBeLessThan(doc.indexOf("gsap.min.js"));
  });
});

describe("resolveGraphic", () => {
  it("renders Claude's code when it passes, the template when it doesn't", () => {
    const g = designed().graphics[0];
    expect(resolveGraphic(g).source).toBe("designed");
    g.code = { ...g.code!, js: `${g.code!.js}\nfetch("https://x")` };
    const r = resolveGraphic(g);
    expect(r.source).toBe("template");
    expect(r.code).toEqual(templateCode(g));
    expect(r.fallbackReasons).toContain("js: network access");
  });

  it("escapes template text and refuses non-colour accents", () => {
    const g = designed().graphics[0];
    g.template = { name: "hookPill", props: { headline: "<b>Hi</b>", sub: "", text: "", cta: "", bg: "", accent: "red;}body{x:url(https://x)" } };
    const c = templateCode(g);
    expect(c.html).toContain("&lt;b&gt;Hi&lt;/b&gt;");
    expect(c.css).toContain("background:#ff4628");
  });
});

describe("renderPlanGraphics", () => {
  it("falls back to the template when a designed graphic fails to render", async () => {
    const plan = designed();
    const render = vi.fn<RenderOne>(async (g, code) => {
      if (g.id === "hook" && code === g.code) throw new Error("Hyperframes render of hook failed: timed out after 120s");
      return { file: `/g/${g.id}`, ms: 10, cached: false };
    });
    const out = await renderPlanGraphics(plan, render, { parallel: 2 });
    expect(out.map((o) => [o.id, o.source])).toEqual([["hook", "template"], ["steep", "designed"], ["endcard", "designed"]]);
    expect(out[0].fallback).toMatch(/^render failed: .*timed out/);
    expect(render).toHaveBeenCalledTimes(plan.graphics.length + 1);
  });

  it("fails when a template itself can't render", async () => {
    const plan = designed();
    for (const g of plan.graphics) g.code = null;
    await expect(renderPlanGraphics(plan, async () => { throw new Error("boom"); }, { parallel: 1 })).rejects.toThrow("boom");
  });
});

describe("documentFor (live preview)", () => {
  it("inlines GSAP, refuses connections and listens for seeks", () => {
    const doc = documentFor("g", 2, ok, false, { gsap: "/*gsap*/var gsap={};", interWoff2DataUrl: "data:font/woff2;base64,AAAA" });
    expect(doc).toContain("connect-src 'none'");
    expect(doc).not.toContain('src="gsap.min.js"');
    expect(doc).toContain("/*gsap*/var gsap={};");
    expect(doc).toContain('src: url(data:font/woff2;base64,AAAA) format("woff2")');
    expect(doc).toContain('d.type === "seek"');
  });
});

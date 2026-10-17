/**
 * The words in a Designed graphic, for editing them on the timeline.
 * Claude writes a graphic's text as plain text between tags in its HTML
 * (the animation lives in the JS), so each run of text between tags is
 * one editable field and editing it changes only that run. The result is
 * still checked by checkGraphicCode() like any other graphic code: new
 * text is escaped, so it can't add markup.
 */

const TEXT_RUN = />([^<>]*\S[^<>]*)</g;

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

function decode(s: string): string {
  return s.replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (e) => ENTITIES[e]);
}

function encode(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The text runs in a graphic's HTML, in document order. */
export function designedTexts(html: string): string[] {
  return [...html.matchAll(TEXT_RUN)].map((m) => decode(m[1]).trim());
}

/** The HTML with text run `index` replaced, keeping the whitespace around it. */
export function setDesignedText(html: string, index: number, text: string): string {
  let n = -1;
  return html.replace(TEXT_RUN, (whole, inner: string) => {
    n += 1;
    if (n !== index) return whole;
    const lead = inner.match(/^\s*/)![0];
    const trail = inner.match(/\s*$/)![0];
    const clean = text.replace(/[\r\n]+/g, " ").slice(0, 200);
    return `>${lead}${encode(clean)}${trail}<`;
  });
}

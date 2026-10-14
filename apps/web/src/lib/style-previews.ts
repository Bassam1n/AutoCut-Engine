/**
 * The sample subject each built-in style is previewed with. A preview has
 * to sell the LOOK, so each subject is chosen to exercise what that style
 * is for (an anatomy reveal for Anatomy Glow, a creator mid-sentence for
 * Creator UGC) rather than one generic subject for every style. Editable
 * in the UI before generating; custom org styles fall back to DEFAULT.
 */
const SHOWCASE: Record<string, string> = {
  "3D Reveal B-Roll":
    "An exploded cutaway of a sleek wireless earbud floating mid-air: shell, battery, driver and circuit board separated along one axis with soft studio light, macro detail on brushed metal and glass.",
  "Anatomy Glow":
    "A friendly woman in her 40s turns her head; her neck becomes translucent frosted glass and the cervical vertebrae and the tense muscle around them glow warm orange, the rest of her calm and smiling.",
  "Clay Studio":
    "A plasticine coffee cup character with big googly eyes yawning on a clay kitchen counter at sunrise, thumbprints visible in the clay, tiny clay steam curls rising.",
  "Commercial Cartoon":
    "A cheerful cartoon young man at a desk lifting a can of cold brew like a trophy, sparkles around the can, bold clean shading, bright social-ad colors.",
  "Creator Swap":
    "A relaxed woman in her late 20s talking to her phone camera in her car, holding a small skincare bottle toward the lens, natural daylight through the window.",
  "Creator UGC":
    "A guy in his early 30s filming himself on his phone in a lived-in kitchen, mid-sentence and pointing at a resistance band set on the counter, natural window light.",
  "Feature 3D":
    "An animated grumpy little muscle-knot character with crossed arms sitting on a giant shoulder like a mountain, warm cinematic light, expressive face, feature-animation polish.",
  "Grid Studio Explainer":
    "A small open set inside a bright studio: a giant skincare dropper bottle beside a cutaway of layered skin, a tiny presenter character gesturing toward it, soft even light.",
  "Heritage 3D":
    "A broad-shouldered caricature of a vintage barber in a striped apron holding scissors with a proud grin, geometric silhouette, classic feature-animation styling.",
  "Lifestyle B-Roll":
    "A candid phone shot of a woman stretching beside a sunny window in a small apartment, coffee mug on the sill, slightly off-center framing.",
  "Noir Panel":
    "A detective-style man under a single streetlight holding a glowing product box, rain streaks, angular painted shading, deep shadows and a red accent.",
  "Pure Product":
    "A single amber glass serum bottle with a dropper on a wet stone surface, a few water droplets, soft key light and a clean gradient background.",
  "Reference Match":
    "A neatly styled flat-lay of a morning routine: coffee, phone, notebook and sunglasses on a linen tablecloth, soft natural light.",
  "Retro Reel":
    "A rubber-hose cartoon alarm clock with arms and legs dancing on a bedside table, wobbly inked outlines, warm 1930s colors.",
  "Wool Felt World":
    "A needle-felted miniature café with a tiny felt barista pouring a cup of coffee, fuzzy wool textures, warm stop-motion lighting.",
};

const DEFAULT =
  "A person in their 30s holding a product toward the camera in a bright, everyday setting, clearly showing the style's look.";

export function defaultPreviewSubject(styleName: string): string {
  return SHOWCASE[styleName] ?? DEFAULT;
}

/** Style masterprompt + the showcase shot, sent straight to the image model. */
export function buildStylePreviewPrompt(masterprompt: string | null, subject: string): string {
  return [
    masterprompt?.trim() ?? "",
    "",
    "PREVIEW FRAME",
    "Render ONE still frame that showcases this style at its best, as a thumbnail for a style gallery. Vertical 4:5 composition. No text, captions, logos or watermarks.",
    `Subject: ${subject.trim()}`,
  ]
    .join("\n")
    .trim();
}

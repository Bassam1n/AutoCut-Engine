# Hyperframes Composition Brief: AutoCut Engine

## Objective
Create a short launch-style brag video for AutoCut Engine.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape, 1920x1080, 30fps
- Duration: 21.6 seconds

## Source Material
- Project root: repo root (`apps/web` is the Next.js app)
- Primary files read: `README.md`, `docs/HERMES_WEB_SPEC_V2.md` (sections 1-2), `apps/web/src/app/globals.css`, `apps/web/src/app/layout.tsx`, `apps/web/src/app/org/[orgId]/brands/[brandId]/products/[productId]/ads/[adId]/{stepper,scripts-step,storyboard-step,export-step}.tsx`, `apps/web/public/logo.png`
- Product name: AutoCut Engine
- Tagline / strongest claim: "Brief to finished MP4."
- Key UI to recreate: the Scripts step (three variant cards, "Use this script" / "Selected ✓"), the nine-step Stepper with orange active chip and per-scene counters, storyboard rows with Hook 1 / Body / CTA chips and "Product in frame ✓", the Export "Download all" button
- Copy that must appear verbatim:
  - "Brief" / "finished MP4." (from "Brief to finished MP4")
  - "Video ad production for agencies."
  - "Generate 3 scripts", "Use this script", "Selected ✓"
  - Stepper labels: Scripts, Fine-tune the brief, Scene plan, Concept & cast, Storyboard, Scene images, Voiceover, Scene videos, Export
  - "Human approval gates. No self-approval."
  - "Download all"

## Creative Direction
- Tone preset: app-store
- Creative direction: an ad about the ad-maker, cut in its own Hook / Body / CTA structure
- Interpretation: clean product-film pacing, smooth slides, real UI large and crisp, one claim per scene
- Angle: the app's own storyboard chips (Hook 1, Body, CTA) label the video's chapters
- Hook: dark frame, "Brief" slams in, an orange arrow draws, "finished MP4." lands
- Outro / punchline: Download all, `ad_final.mp4` lands, ACE logo + "AutoCut Engine"
- Avoid: generic SaaS language, abstract filler, redesigning the UI, invented metrics

## Visual Identity
- Background: `#faf9f6` (raised `#ffffff`), hook in `#121212`
- Text: `#16171a`, muted `#65666b`
- Accent: `#e8521f` (dark `#f06a35`), soft `#fbe6dc`, borders `#e4e2dc` / `#cfccc3`
- Display and body font: Geist (local woff2 via @font-face); Geist Mono for counters and file names
- Visual references: rounded-xl cards with 1px borders, rounded-full chips, orange filled primary buttons

## Storyboard
Creative contract: `brag-output/brag-plan.md`.
1. Hook, 3.0s: "Brief" then arrow then "finished MP4." on dark
2. Reveal, 2.5s: ACE logo, name, "Video ad production for agencies."
3. Three scripts, 4.5s: click Generate, three cards deal, select Variant 2
4. Stepper runs, 4.5s: nine chips tick to ✓, counters fill, storyboard rows
5. Approve, 3.0s: gate card, Approve clicked at 17.02s
6. CTA, 3.5s: Download all, file chip, logo lands at 20.02s

## Audio
- Audio role: warm upbeat bed plus a light UI layer
- Music: `happy-beats-business-moves-vol-1-by-ende-dot-app.mp3`, volume ~0.32, fade in 0.4s, fade out from ~19.6s
- Music cue guidance: `assets/music/cues/happy-beats-business-moves-vol-1-by-ende-dot-app.music-cues.json`; strong cues 17.02 (Approve), 20.02 (logo); script cards on every other beat (6.52, 7.52, 8.52)
- Audio-reactive treatment: subtle; RMS drives the soft orange glow behind the active card and the logo
- SFX: low-HF picks from `sfx-analysis.md`: `interface/click_003` for presses, `casino/card-slide-1` for the card deal, `impact/impactSoft_medium_001` for the hook slam, `impact/impactBell_heavy_000` for Approve, `interface/drop_001` for file/logo landings, `interface/bong_001` sparingly
- Audio files live in `composition/assets/`

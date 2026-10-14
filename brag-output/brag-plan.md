# Brag Plan: AutoCut Engine

## What is this app?
A web app for video ad agencies: an editor picks a brand and product, generates three scripts, picks one, and walks it through scene plan, storyboard, scene images, voiceover and scene videos to an export, with a human approving every step.

## The angle
**An ad about the thing that makes ads, cut the way AutoCut cuts one.** The app splits every storyboard into labelled groups (`Hook 1`, `Body`, `CTA`). The brag video uses those same chips as its own chapter markers, so the viewer watches the product's structure applied to the product's own launch. Everything shown is the real Studio UI: cream canvas, orange accent, Geist, the numbered stepper, the variant cards.

## Hook (first 2-3 seconds)
Dark frame (the app's own dark-mode colours). The `Hook 1` chip blinks on, top left. Giant type slams in: **"Brief"**. A beat later an orange arrow draws across and **"finished MP4."** lands. That is the product's own one-line description ("Brief to finished MP4") and it answers "what is this?" in two seconds.

## Key moments (the middle)
- **Three scripts, pick one.** The real Scripts step: the cursor clicks "Generate 3 scripts", three variant cards (hook / body / CTA in orange) deal in one by one, the cursor clicks "Use this script" on Variant 2 and it flips to "Selected ✓".
- **The stepper runs.** The real nine-step stepper (Scripts → Fine-tune the brief → Scene plan → Concept & cast → Storyboard → Scene images → Voiceover → Scene videos → Export) ticks each chip to ✓ while the per-scene counters (`3/6` → `6/6`) fill in, over a storyboard of scene rows tagged Hook 1 / Body / CTA with "Product in frame ✓".
- **You approve it.** A gate card: "Storyboard ready for review". The cursor clicks Approve. Copy: "Human approval gates. No self-approval." (from the README and the spec's "honest gates (no silent fallbacks, no self-approval)").

## Outro / punchline
The `CTA` chip blinks on. Export step: "Download all" clicked, an `ad_final.mp4` file chip lands. Then the ACE logo, "AutoCut Engine", and "Video ad production for agencies." End on the logo.

## User flow worth showing
Pick a script (entry) → the stepper advances through storyboard, images, voiceover and videos (key action) → approve and download the finished MP4 (result).

## Tone
- Preset: app-store
- Creative direction: "an ad about the ad-maker, cut in its own Hook / Body / CTA structure"
- Interpretation: clean product-film pacing, smooth slides and dips, the real UI shown big and sharp, one confident claim per scene, no jokes forced in. The meta structure carries the wit.

## Format: landscape, 1920x1080, 30fps
## Duration: 21.6s

## Visual identity (from the project)
- Background: `#faf9f6` (raised surfaces `#ffffff`); hook scene uses dark mode `#121212`
- Accent: `#e8521f` (dark mode `#f06a35`), accent-soft `#fbe6dc`
- Text: `#16171a`, muted `#65666b`; borders `#e4e2dc` / `#cfccc3`
- Display font: Geist (semibold, tight tracking, as in the app's headings)
- Body font: Geist; Geist Mono for counters and the file name
- Strongest visual element: the numbered stepper with orange active chip, plus the ACE logo (`apps/web/public/logo.png`)

## Fictional stand-ins
The real Studio shows the user's own brands and products. The video uses a made-up brand, **"Northbeam Cold Brew"**, and made-up script copy. No real customer, user, email or key appears.

## Share copy (draft)
AutoCut Engine: pick a brand and a product, choose one of three scripts, approve each step, and download a finished ad MP4. Built for video ad agencies.

## Audio direction
- Role: warm, upbeat bed with a light, consistent UI layer
- Music: `happy-beats-business-moves-vol-1-by-ende-dot-app.mp3` (120 BPM)
- Music treatment: start at 0, bed around 0.32, short fade in, fade out under the final logo
- Music cue guidance: preset `assets/music/cues/happy-beats-business-moves-vol-1-by-ende-dot-app.music-cues.json`. Strong cues to target: **17.02s** (Approve lands), **20.02s** (logo lands). Beat grid every ~0.5s from 3.02s: the three script cards deal on every other beat (~1.0s apart) so each can be read; stepper chips can tick on single beats because they are accents, not reading.
- Audio-reactive treatment: subtle. Music RMS/bass makes the soft orange glow behind the active UI card and the final logo breathe slightly. No waveforms or bars.
- SFX posture: moderate, motion-matched, low high-frequency risk. Clicks on the cursor presses, soft card sounds on the deal, one soft impact on the hook, one bell on Approve or the logo.
- Audio-coupled moments: hook word slam, cursor clicks, card deal, stepper ticks (sparse accents only), Approve, file landing, logo.
- Restraint rule: no stacked hits, nothing harsh, ticks sit under the music.

## Storyboard

### Scene 1: Hook, 3.0s (0.0 to 3.0)
Dark `#121212`. `Hook 1` chip appears top left (the app's chip style). "Brief" slams in huge, holds; an orange arrow draws; "finished MP4." lands and holds at least 1.2s.
Sequential/interaction: yes, two-part word reveal.
Audio intent: confident start.
Audio-coupled idea: soft impact as "Brief" lands, lighter accent on "finished MP4."
Transition mood: clean, dip from dark to the cream canvas.

### Scene 2: Reveal, 2.5s (3.0 to 5.5)
Cream canvas. The ACE logo scales in, "AutoCut Engine" appears beside it, then "Video ad production for agencies." Hold.
Sequential/interaction: logo, then name, then line.
Audio intent: lift.
Audio-coupled idea: soft drop when the logo lands.
Transition mood: smooth slide into the app window.

### Scene 3: Three scripts, 4.5s (5.5 to 10.0)
`Body` chip top left. A browser-style app window: the Scripts heading and helper copy, "Ad length (seconds)" field at 30, the orange "Generate 3 scripts" button. The cursor clicks it; three variant cards deal in about 1s apart (Variant 1/2/3, bold hook line, muted body, orange CTA). The cursor clicks "Use this script" on Variant 2, its border turns orange and the button reads "Selected ✓".
Sequential/interaction: yes, a click, a three-card deal, a click to select.
Audio intent: tactile.
Audio-coupled idea: clicks on both presses, a card slide on each deal.
Transition mood: slide.

### Scene 4: The stepper runs, 4.5s (10.0 to 14.5)
The app window now shows the stepper across the top and a storyboard below: three scene rows tagged Hook 1 / Body / CTA with "Product in frame ✓". The stepper chips tick to ✓ one by one across the nine steps; the Scene images / Voiceover / Scene videos counters fill (`6/6`). Overlay copy, held: "Storyboard, images, voiceover, video."
Sequential/interaction: yes, chips ticking in sequence.
Audio intent: momentum.
Audio-coupled idea: very light ticks on a few chips, not all nine.
Transition mood: clean.

### Scene 5: You approve, 3.0s (14.5 to 17.5)
A gate card: "Storyboard ready for review", with Approve and Request changes buttons. The cursor clicks Approve at 17.02 (beat-locked); a ✓ appears. Copy, held: "Human approval gates. No self-approval."
Sequential/interaction: yes, a cursor click.
Audio intent: confirmation.
Audio-coupled idea: click plus a bell on Approve.
Transition mood: soft dip.

### Scene 6: CTA, 3.5s (17.5 to 21.0)
`CTA` chip. Export step: "Download all" clicked, an `ad_final.mp4` chip slides in. It resolves to the ACE logo, "AutoCut Engine" and "Brief to finished MP4.", with the logo landing on the 20.02 cue. Music fades out.
Sequential/interaction: yes, a click and a file landing.
Audio intent: payoff, then rest.
Audio-coupled idea: click, soft drop on the file, logo accent.

**Music mood for this video:** upbeat
**Audio summary:** an upbeat bed carries a light layer of clicks and card sounds, a bell confirms the Approve, and the music fades under the logo.

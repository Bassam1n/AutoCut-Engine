# DESIGN.md: autocutengine.app (redesign with /awwwards)

## Brief
- Subject: AutoCut Engine, a web studio where a video-ad agency goes from a product brief to scenes, review and export for every client brand.
- Audience: owners of small and mid-size video-ad agencies (first market Pakistan). They buy after a demo or a referral.
- Job of the site: make the pain obvious in 3 seconds, show the real product, and collect access requests (the form posts to studio.autocutengine.app/api/access-request).
- Stack: the existing static site (plain HTML, CSS, JS, no build step, Vercel serves this folder). GSAP 3.15 (ScrollTrigger, SplitText) and Lenis 1.3 are vendored in `assets/vendor/`, so the stack stays build-free.
- Assumptions: no prices on the page (the per-brand offer is not final); "we set you up in person" reflects the in-person onboarding; Auto-edit is described as coming next, not shipped.

## Concepts
| | Idea | Anchor | Signature | O/F/Fe/P |
|---|---|---|---|---|
| A. Process | Making one ad today means six open tabs (chat, Higgsfield, CapCut, Drive, WhatsApp, Trello). Scrolling closes them one by one until only AutoCut is left. | the exact tool chain agencies described | the tab strip snaps shut, tab by tab, as you scroll | 4 / 5 / 4 / 2 |
| B. Material | The page is an edit timeline: a playhead runs in timecode from brief to export | AutoCut ends in a timeline | a scroll-synced playhead and clips | 3 / 4 / 4 / 3 |
| C. Formal | Everything is a 9:16 frame, the page plays like a reel | the output format | vertical frames advance like a reel | 3 / 3 / 4 / 3 |

Pick A: it is the agency's own day, it is specific to this product, and it explains the value without a sentence. Steal from C for the end state: the last tab shows the real studio.

## Concept card
```
Idea:        One ad takes six tabs today. AutoCut closes five of them.
Metaphor:    a browser tab strip
Signature:   sticky hero: scrolling closes the six tool tabs one by one; a ledger checks off each job as AutoCut absorbs it; the last tab opens the real studio
Emotion:     recognition, then relief
Motion verb: snap shut (fast width collapse, neighbours slide in)
Screenshot:  two tabs left, the ledger mostly checked, the studio half visible
```

## System
- Palette (browser chrome): ground #e9e9ec (tab strip grey), surface #ffffff (open tab), ink #111214, muted #55565c, line rgb(17 18 20 / .12), accent #e8521f (AutoCut orange: its tab, CTA fill, focus ring), curtain = ink.
- Type: Archivo variable (display, wght 800, wdth 112 to 125, tracking -0.04em) and Geist (text and UI). Geist Mono only for real URLs in tabs.
- Grid: 12 columns, fluid gutter. Lines at col 1, col 7, col 9.
- Shape: one radius, 10px (tabs, windows, buttons, fields).
- Motion: ease.out expo.out, ease.soft power3.out. Tab close 0.42s. Reveals 1.1s lines.
- Treatments: CTA = orange fill floods from the pointer side; nav = underline draws; product rows = title slides and the real screenshot follows the pointer (touch: inline thumbnails). Utility links change colour.
- Idle: the open tab's loading ring keeps turning and the WhatsApp tab's unread count ticks up while it is open (review comments piling up). Off under reduced motion.

## Sections (one layout family each)
1. Hero, sticky stage (poster + the window).
2. Statement.
3. Index list: inside the one tab, with real screenshots.
4. Asymmetric pair: how you start (a real sequence).
5. FAQ.
6. Finale: access form under a giant "One tab."
404: a single empty tab.

## Genericness test
- Default would be a centered hero with a product screenshot and three feature cards. Replaced by the tab strip and an index list.
- Default palette would be the app's cream and orange. Moved to browser grey with orange kept for the AutoCut tab only.

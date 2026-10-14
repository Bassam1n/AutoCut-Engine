# BRIEF: AutoCut Engine landing page

**Self-authored under explicit creative delegation.** The owner's instruction was "create the website now give me the code". The interview questions were asked earlier in the session and not answered. Every answer below is an authored decision, marked as such, grounded in the repo (`README.md`, `docs/HERMES_WEB_SPEC_V2.md`, `apps/web`). No user quotations are invented.

## Evidence vs assumption

| Fact | Source | Status |
|---|---|---|
| Web app for video ad agencies; brand, product, style, brief, storyboard, per-scene images and videos, voiceover, captions, human approval gates | README | Evidence |
| Studio steps: Scripts, Fine-tune the brief, Scene plan, Concept & cast, Storyboard, Scene images, Voiceover, Scene videos, Export | `stepper.tsx` | Evidence |
| Three script variants with hook, body, CTA | `scripts-step.tsx` | Evidence |
| Storyboard rows grouped Hook 1-3 / Body / CTA, product-in-frame toggle, split, merge, edit by chat | `storyboard-step.tsx` | Evidence |
| Export zip names files by scene: `01.mp4`, `01-image-1.png`, `01-voiceover`, `01-captions`, `01-02.mp4` | `lib/download/zip-naming.ts` | Evidence |
| Per-org and per-brand provider keys; customers pay their own AI costs | spec §1, `settings/keys` | Evidence |
| Spend guard, cost visible before the click | spec §2.9, `settings/spend` | Evidence |
| Gates only resolvable by a signed-in human; no self-approval; no silent fallbacks | spec §2.3-2.4 | Evidence (spec rule) |
| A single assembled final MP4 | README claims it; `srt.ts` says "a render step, which doesn't exist yet" | **Not claimed on the page** |
| Autopilot mode | README; not found in the Studio UI | **Not claimed on the page** |
| Pricing ($99/editor/month) | internal spec only | **Not published on the page** |
| Public availability | none found | Assumed pre-launch, so the CTA is "Request access" |

## The eight topics (authored)

1. **Vibe:** calm, exact, workmanlike, warm. References: a film editor's cutting room at night; a printed call sheet; the app's own cream-and-orange Studio.
2. **Scroll journey:** the visitor lands inside the Studio with a brief already written, watches three scripts arrive and one get picked, sees that script become a storyboard, watches every scene get its image, voiceover and video, is asked to approve before anything can be exported, gets the export, then sets up their own agency.
3. **Energy curve:** calm open, quiet storyboard, the loudest act is the media run, then a full stop at the gate, then calm resolution.
4. **Feeling, stage by stage, and the one moment:** see the feeling curve and peak below.
5. **The thing no site does:** the page will not let you export until you, personally, press Approve. Seed of the signature move.
6. **Distance from premium-minimal:** dense, information-forward (the "dense" family), in the product's own light UI idiom. Not dark luxury.
7. **One world or distinct scenes:** neither. The page is the working surface; scroll advances its state.
8. **Assets:** the ACE logo (`apps/web/public/logo.png`), the app's palette and Geist type, the Studio UI as code. No photography, no API key for generation, so nothing generated. Sample brand "Northbeam Cold Brew" is fictional and labelled as such on the page.

## Step 1 answers (authored)

1. **What and who:** a web app where video ad agencies take a product from brief to every scene of an ad, with an editor approving each step.
2. **Believe by the end:** the machine does the production, and nothing moves without a human saying yes.
3. **Next action:** one label everywhere: **Request access**.
4. **Assets:** as topic 8.
5. **Art direction:** the product surface itself, light ground, one orange accent (two lightnesses of one hue for the dark peak act).

## Journey

```
1  Recognition   the Studio, a brief already written, three scripts arriving
2  Clarity       the chosen script becomes a storyboard you can edit
3  Momentum      every scene gets image, voiceover and video, one by one
4  Responsibility  the run stops. Export is locked until you approve
5  Payoff        the export manifest, named by scene, downloadable
6  Commitment    a first-run step: set up your agency
```

## Grammar: Live surface

The honest pitch is "watch what it does", so the page is the product running. App chrome replaces nav (the real nine-step stepper is the navigation), the hero is the surface already in a state, the close is an actual input. Every panel computes from a data array in the page; the page states on its face that the data is a sample.

Why the other seven lost:
- **Filmic one-shot:** a launch film of a tool would be a video of a screen. The brag video already does that job.
- **Chaptered editorial:** the substance is a workflow, not an essay.
- **Continuous world:** no geography; there is nowhere to travel.
- **Typographic poster:** the product's asset is its surface, not a sentence.
- **Gallery / catalog:** there is no range of objects to browse.
- **Split stage:** "manual vs AutoCut" would need invented comparison numbers.
- **Rhythmic cutlist:** wrong energy for agencies buying a production tool.

## Signature move

**The human gate.** Mid-page the run halts on a real gate card. The export panel below it is locked and says so. Only a click on Approve (or Enter on it) unlocks it, stamps "Approved by you" with the scene count, and carries that approval into the export files and into the close form's message. "Request changes" takes a typed note and sends the visitor back to the storyboard with the note attached. Nothing auto-approves on scroll.

## Fingerprint gate

Registry at `scrollcraft/FINGERPRINTS.md` is empty. First build, nothing to clear. Pass.

## Feeling curve (written before the score)

```
1  Recognition     the Studio already mid-job; three script cards settle from in front of the window into their slots
2  Clarity         the picked script splits into scene rows you can split, merge and toggle
3  Momentum (PEAK) the ground goes dark and six scenes run image, voiceover, video in sequence until every lane is done
4  Responsibility  silence after the run: one card, "Waiting on you", and a locked export
5  Relief          approve, and the export opens with every file named by scene
6  Readiness       a first-run form with a cursor in it
```

Adjacent feelings all differ.

## Peak

> "You scroll and the whole ad gets made in front of you, every scene getting its picture, voice and video, and then it just stops and waits for you to approve it."

Lives in act 3 (media run). Largest span on the page (3.0 viewport-heights); the act before it (storyboard) is quiet flow.

## Tell-someone sentence

**It's the site where the ad builds itself while you scroll, then refuses to let you export it until you press Approve.**

## Authored silence

Act 4 opens on a single gate card with nothing animating. That stillness is intentional, not dead scroll. It is a flow section, so the harness should not see pinned dead travel there.

## Score

| Beat | Device | Why |
|---|---|---|
| 1 Recognition | `pin` (1.6) + `parallax` planes | The surface holds while foreground script cards travel at a different rate and land in the window |
| 2 Clarity | flow + `reveal` | Rows wipe in as the script splits; a state change, not a pinned argument |
| 3 Momentum (peak) | `pin` (3.0) | The surface holds while scene state advances from `--sc-p`; largest span |
| 4-5 Gate + export | flow + `in` + click | The page stops being scroll-driven and needs a human |
| 6 Readiness | `pin` (1.2), ground present | A first-run input held on screen, holds to the end |

Families: pin, parallax, reveal, flow/in (4). No family twice in a row. No scrub, kinetic, spotlight or magnet (grammar bans). Two grounds, painted per section, no drift interpolation. 5 acts, about 9 viewport-heights.

## Feel check (after build, cold scroll)

Felt, one word per act: **recognition** (cards landing in the Studio), **calm** (storyboard), **momentum** (dark run, lanes filling), **stop** (the gate), **ready** (form).

Diff against the intended curve: act 2 felt calm rather than "clarity"; acceptable, it is the quiet act before the peak, which is what the peak needs. Relief only happens if the visitor clicks Approve, which is the point of the signature move; a visitor who never clicks sees a locked export, by design. Changes made after the check: pulled the media status line up under the tiles (it floated at the screen bottom), stopped the workspace drifting under the header on phones, compacted tiles on short phones so all six fit.

## Verification record

- `shoot.mjs` desktop 1440x900, phone 390x844, compact 360x640, reduced motion: no dead scroll, contrast clear on every pass. Contact sheets in `lab/*/sheet.png` (not committed).
- `lab/functional.mjs`: 87 checks across desktop, phone and compact, all passing on the final files: split, merge, product toggle, tiles and counts follow edits, export locked before approval, empty change note rejected, changes send you back with the note, approval unlocks export, scope filter recomputes the manifest, download filename and contents, editing after approval re-locks, form validation, honest mailto status, POST form for no-JS, skip link first in tab order, stepper links jump, no console errors, no failed requests, no horizontal overflow.
- Not verified: a real phone (iOS Safari, Android Chrome), a real mail client opening the mailto link, and the deployed URL.

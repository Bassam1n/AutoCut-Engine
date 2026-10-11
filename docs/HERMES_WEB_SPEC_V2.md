# Hermes Ad Engine Web Rebuild: Build Spec for Claude Code (v2)

Date: 2026-10-11 · Author: Bassam · Supersedes: `HERMES_WEB_BUILD_PLAN.md` (v1, which assumed the Hermes VPS agent stays as the runtime)

## 0. How to use this document

- You are building a new multi-tenant web app from scratch. The existing Hermes pipeline (Discord front end, Python orchestrator on a VPS, LLM agent) is a source of editorial rules and provider know-how. It is not a runtime dependency.
- Work through milestones M0 to M13 in order. One branch and one PR per milestone. Stop at each "Done when" list, run its checks, and report.
- Read section 9 (Open questions) first and ask the human before starting M0.
- "Verify" means check the claim against the repo or the provider docs. If reality differs from this document, reality wins and you report the difference.
- Write an ADR (`docs/adr/NNN-title.md`) for every decision marked ADR.
- Do not access, log into, scrape or call any competitor product or its API. Build from this spec only. Do not paste any third party's text or prompts into this repo.
- Items tagged **[NEW]** are additions Hermes has that the reference product class lacks. Everything else is parity with how a typical web ad studio works: brand, product, style, brief, storyboard table, per-scene image and video generation, feedback, library.

## 1. Product in one page

**What it is.** A web app for video ad agencies. An editor picks a brand, a product and a visual style, writes a brief (or drafts one from a product URL), and gets a storyboard, per-scene images and videos, voiceover, captions and a finished MP4, with human approval gates.

**Who pays.** Agencies pay $99 per editor per month (target: 20 to 50 agencies, 2 to 5 editors each). Customers also pay their own AI costs. Each org supplies its own Anthropic API key and its own media provider keys. The platform never uses Claude subscription logins or OAuth tokens, because Anthropic's terms do not permit routing a user's subscription credentials through a third party product.

**Value claim to protect.** Editor output goes from about 2 to 3 finished ads a day to 6 to 8.

**Two modes on the same building blocks.**

- **Studio.** Interactive. The editor drives each step: brief, concept, storyboard table, per-scene image and video generation, feedback, library, download.
- **Autopilot [NEW].** From a product URL and a brief, a durable workflow chains the same blocks end to end, stops at human gates, and produces a final assembled MP4 plus hook by body variants.

**Differentiators [NEW].** Assembly to a final MP4, ElevenLabs voiceover with word-level timing and captions, semantic B-roll search, overlays, hook by body variant matrix, editor style training, Meta performance feedback loop, and honest gates (no silent fallbacks, no self-approval).

## 2. Ground rules

Treat each as a failing-test condition, not a preference.

1. **Deterministic app, bounded LLM calls.** Claude is called at fixed points with structured outputs. The app, not the model, decides flow, gates and skipping. No autonomous agent loop controls the pipeline.
2. **Structured outputs only.** Every LLM call uses a JSON schema (tool use), validated with zod. On validation failure retry once with the error message, then set the job to `needs_human`. Never parse free text.
3. **No silent fallbacks.** Any substitution (TTS provider swap, overlay degraded to plain text, stock clip replaced by generated clip, model switched) writes a `fallback_events` row and shows a visible note in the UI. A substitution that changes what the editor already approved is a gate, not a note.
4. **Gates are rows.** Only a signed-in human session can resolve a gate. The workflow re-reads the gate row from the database on resume and never trusts an event payload. Editor gates never time out into approval. Anything that times out goes to `needs_human`.
5. **Customer-paid AI.** Per-org API keys live encrypted in Supabase Vault. They never reach the browser, logs, job payloads or Realtime payloads.
6. **Multi-tenant from migration 1.** Every table has `org_id` and RLS. No table ships without a policy and a test.
7. **Idempotent and resumable.** Every job has an idempotency key. A provider submit stores the external task id before polling. A retry first checks the status of the stored task and never submits (and pays) twice.
8. **Archive, never delete.** Regenerated assets get a new version and the old one is flagged `archived`. Work invalidated upstream is marked `stale`, not deleted.
9. **Cost is visible before the click and recorded after.** A spend guard can pause paid actions per org.
10. **Provider-agnostic.** Provider adapters behind one interface. Model controls render from `parameter_schema`, so a new model needs no UI release.
11. **Prompts are data.** Prompts live in `prompt_versions`. Every LLM and provider call records model, prompt version and input hash.
12. **Advisory checks stay advisory and honest.** QA badges never block, and the UI never claims a result was verified when it was not.
13. **Fix root causes in code.** No session-level patches and no manual database edits to make a test pass.

## 3. Architecture

```text
  Editors (browser)                     Customer's own Claude Code (optional, M13)
        |                                              |
        v                                              v
 +-----------------------------------------------------------------+
 |  Next.js on Vercel: UI, server actions, MCP route, webhooks     |
 +-----------------------------------------------------------------+
     |  RLS reads, RPCs          ^ Realtime              | events
     v                           |                       v
 +--------------------------------------------+   +-------------------------+
 | Supabase: Postgres + RLS, Auth, Storage,   |   | Workflow engine         |
 | Realtime, Vault (per-org keys)             |<->| (Inngest or Trigger.dev)|
 +--------------------------------------------+   | steps: LLM, providers   |
        ^                                         | gates: wait + re-read   |
        | outbound only: claims render jobs       +-------------------------+
        |                                                    |
 +--------------------------+                                v
 | Render service (Docker)  |                      Anthropic API (org key)
 | ffmpeg: assembly,        |                      kie.ai, fal.ai, xAI, ElevenLabs,
 | captions, overlays       |                      TwelveLabs, Pexels, HeyGen (org keys)
 +--------------------------+
```

| Concern | Decision | Notes |
| --- | --- | --- |
| Web | Next.js App Router, TypeScript, Tailwind, shadcn/ui, on Vercel | |
| Data, auth, files, realtime | Supabase: Postgres with RLS, Auth, Storage, Realtime, Vault | |
| Orchestration | Durable workflow engine, Inngest or Trigger.dev (ADR) | Choose after checking current pricing, step time limits, Vercel fit and local dev. Gates use "wait for event" and then re-read the database |
| LLM | Anthropic API with the org's key | Verify current model IDs at docs.claude.com before pinning. As of 2026-10-11 the available strings include `claude-sonnet-5-5` (storyboard, concepts, prompt writing, vision QA), `claude-haiku-5-5` (classification, routing, cheap checks) and `claude-opus-5-5` (only for a phase that proves it needs it, ADR). Pin one model per task in config |
| Media providers | Adapters. Launch with kie.ai and fal.ai (many image and video models behind one key). Add xAI Grok video, ElevenLabs (voice and speech-to-text), TwelveLabs (semantic search), Pexels, HeyGen as Hermes uses them | |
| Render | Small Docker service running ffmpeg for assembly, captions and overlays. Claims jobs from a Postgres queue, outbound only, no inbound port. Can run on the existing VPS | Only for work that does not fit serverless limits |
| Payments | Stripe for seats | Last, in M13 |

**Primitives.** Build everything as small idempotent job types: `generate_storyboard`, `patch_storyboard`, `write_image_prompt`, `generate_scene_image`, `qa_scene_image`, `plan_video_motion`, `generate_scene_video`, `make_voiceover`, `transcribe_words`, `search_broll`, `render_overlay`, `render_assembly`. Studio calls them from buttons. Autopilot composes them in a workflow with gates.

**Execution path.** UI action, then server action calls an RPC that inserts a `jobs` row, then the workflow engine receives an event and runs steps (LLM call, provider submit, poll with sleep, store asset, record spend), then Realtime pushes the change to the browser.

## 4. Data model

Every table has `org_id` and an RLS policy based on `is_org_member(org_id)`. The browser role gets select on its org's rows and insert or update only on user-authored content (brands, products, product refs, customers, styles, brief fields, scene copy and visual edits, feedback). Everything with side effects goes through security-definer RPCs or the workflow engine with the service role. The service-role key never ships to the browser.

| Table | Key columns | Notes |
| --- | --- | --- |
| `orgs` | id, name, paused, warn_usd, stop_usd | `paused` set by the spend guard |
| `org_members` | org_id, user_id, role (owner, admin, editor), seat_active | one row per billable seat |
| `org_secrets` | org_id, provider, vault_secret_id, last4, verified_at | providers: anthropic, kie, fal, xai, elevenlabs, twelvelabs, heygen, pexels. Never readable by the browser role |
| `brands` | id, org_id, name, logo_url, brand_context | |
| `customers` | id, org_id, brand_id, name, profile (jsonb) | audience profiles: who, pains, desired outcome |
| `products` | id, org_id, brand_id, name, category, what_it_is, url | |
| `product_refs` | id, org_id, product_id, kind (photo, angle, alternate), name, storage_path | |
| `product_specs` | id, org_id, product_id, version, spec, source (vision, human), approved | structural description derived from photos, human editable |
| `styles` | id, org_id (null for platform seeds), name, description, categories, masterprompt, default_image_model_id, default_video_model_id, defaults (jsonb), active | |
| `models` | id, name, capability (image, video, audio), active, prompt_guide | |
| `model_providers` | id, model_id, provider, endpoint, parameter_schema (jsonb), price_rule (jsonb), is_default | |
| `ads` | id, org_id, brand_id, product_id, style_id, mode (studio, autopilot), brief (jsonb), plan_locked, status | |
| `concepts` | ad_id, options (jsonb), selected_idx, locked_cast (jsonb) | |
| `cast_members` | id, ad_id, name, description, ref_asset_id, sheet_asset_id, approved | |
| `scenes` | id, org_id, ad_id, idx, hook_group (hook_1, hook_2, hook_3, body, cta), copy, visual, product_id (nullable), duration_s, route, notes (idea, rule), speaker, status | `product_id` set only when the product is physically in frame |
| `assets` | id, org_id, ad_id, scene_id, kind, version, archived, storage_path, source, qa (jsonb), meta (jsonb) | kinds: image, last_frame, video, broll, vo, caption, overlay, final |
| `jobs` | id, org_id, ad_id, scene_id, kind, status, idempotency_key, external_task_id, provider, attempts, cancel_requested, payload, error_code, error | |
| `phase_runs` | id, org_id, ad_id, phase, status (running, done, failed, skipped, stale), input_hash, model, prompt_version, started_at, finished_at, summary | |
| `gates` | id, org_id, ad_id, phase, kind, actor (editor, agent), payload, status (pending, approved, rejected, needs_human), decided_by, decided_at, decision | |
| `fallback_events` | id, org_id, ad_id, phase, intended, actual, reason | |
| `feedback_events` | id, org_id, ad_id, scene_id, target (image, video, last_frame), mode (tweak, rework), text, remember, created_by | |
| `rules` | id, org_id, scope (org, brand, style, product), kind (do, avoid), text, confidence, reinforced_count, active | distilled from remembered feedback |
| `library_items` | id, org_id, brand_id, asset_id, name, tags, favorite | |
| `prompt_versions` | id, task, version, body, active | |
| `price_table` | provider, model, unit, usd | estimates, labelled as such |
| `spend_events` | id, org_id, ad_id, provider, model, usd_est, kind, created_at | LLM tokens and provider calls |
| `mcp_tokens` | id, org_id, user_id, token_hash, last4, spend_cap_usd, revoked_at | |
| `audit_log` | id, org_id, actor, action, target, created_at | gate decisions, key changes, resumes, role changes |

Storage: private buckets `refs`, `renders`, `library`. Paths `{org_id}/{ad_id}/...`. Policies allow access only when the first path segment is an org the user belongs to. Provider result URLs expire, so copy every generated file into your own storage the moment it completes, then reference only your copy.

## 5. Feature spec

### 5.1 Workspace and access

- Roles: owner, admin, editor. Invite by one-time sign-in link (do not depend on email delivery). Seats are toggled per member.
- Org switcher. A required setup checklist before generation: Anthropic key verified, at least one image provider key, at least one brand with a product.
- Key screens are write-only. They show the last 4 characters and test the key with a cheap call before saving.

### 5.2 Brands, customers, products

- **Brand.** Name, logo, brand context. A "brand architect" chat drafts the context as structured fields (audience, tone, product facts, visual feel, never-generate list, claims rules) and the human edits and saves. Rule for the writer: describe what the frame contains, never list negated nouns, because image models draw whatever a "no ___" list names.
- **Customers.** One or two audience profiles per brand (who, age range, pains in their words, desired outcome). A brief can say "make it for Sarah" and the profile is used without re-asking.
- **Products.** Name, category, one-line "what it is", photos, angle views (all attached to every generation of the product), and alternates (exclusive versions such as flavour or colour, one chosen per scene when its name appears in the scene text, otherwise the first).
- **Product spec.** When photos change, a Claude vision call writes a locked structural description (parts, hardware, markings, sizes). It is versioned and human-editable. Photos outrank text whenever the two disagree.
- **Product in frame.** A scene references the product only when the frame physically contains it. Copy that merely names the product is a mention and stages nothing. The editor can flip this per scene.

### 5.3 Styles, models, providers

- **Style.** Name, description, categories, masterprompt (versioned), default image and video models, per-model defaults, active flag. A style picker shows a gallery with preview images, category tabs, search, favourites and recents.
- **Seed styles must be written fresh.** Do not reuse any third party's masterprompts. The human will supply Hermes's own style rules, which are the starting point.
- **Models.** Registry with capability and per-provider `parameter_schema`. Settings popovers (ratio, quality, count, duration, resolution, audio) render from the schema. A model with more than one provider shows a provider switch, which is the escape hatch when one backend degrades.
- **Adapters.** Interface: `estimate(params)`, `submit(params)` returns an external task id, `poll(id)`, `normalize(result)`, `cancel(id)`. Persist the external id before polling. Detect content-filter blocks, rate limits and timeouts and map them to the error vocabulary in 5.10.

### 5.4 Brief, planning, concept

1. **Brief form.** Up to three removable hooks, body, call to action, free-text idea. Optional product URL [NEW]: fetch the page (block private network addresses, cap size and time), and a Claude call extracts claims, benefits, objections and audience into a draft brief the editor edits.
2. **Dial it in (optional).** Claude asks up to N short questions, one at a time, with tap-to-answer chips and a "you decide" option. First about the viewer (who, age, problem, pains, desired outcome), then about the ad (who is on screen, the world, the look, the goal, the mechanism of how the product works, and whether anyone speaks on camera). It ends with a customer card the editor can save to the brand. A skip button always exists. Answers already in the brief or a saved customer are not asked again.
3. **Scene plan card.** The copy is split into scenes using the style's cutting rules (fast styles cut about one sentence per scene, UGC styles keep whole takes). Show estimated length per scene from word count (default about 3.25 words per second, clamped to the chosen video model's allowed range). The editor can edit copy, split, merge by drag, add or delete scenes, and pin a note per scene: an **idea** (the writer may adapt it) or a **rule** (kept word for word, survives regenerations, wins over an idea). Hook groups (hook 1, 2, 3, body, CTA) show as banners. **Lock the plan** freezes the split: later steps never re-split it.
4. **Concept and cast.** Claude pitches three visual concept directions (title, story, first frame, scene-by-scene, world, standout moments). The editor picks one, refines it in plain language, or adds their own. Accepting extracts the cast. Each character gets one reference image on a plain backdrop (face visible, drawn in the chosen style). The editor can give feedback per character (small change edits the picture, big change redraws), approve, or upload their own. Optional character sheet (front, side, poses, expressions) for consistency. Approved cast images attach automatically to every scene that includes the character.
5. **Storyboard generation.** Claude writes one row per scene with copy verbatim, a Visual description, and a Product cell. It also writes a short WORLD block (1 to 3 locations, one fixed sentence each) and repeats that sentence in every scene set there, so environments stay identical. The cost of this call is shown and recorded.

### 5.5 Storyboard table

- Columns: scene number, copy, visual, product (in frame or not, flip with one click). Inline editing. Hook and body banners.
- Split a scene (pre-split copy, edit both halves). Merge by dragging a row onto its neighbour. Drag an image onto another scene to move it.
- **Edit by chat.** A chat box patches the board in place. Claude returns a patch (list of cell edits, added rows, product switch), validated against a schema, never a regenerated board. Existing images and videos stay. Images are never regenerated automatically after a patch.
- Scene progress rail (one dot per scene, colour by stage, click to jump). A scene overview panel with thumbnails (image or video mode).

### 5.6 Scene images

- Count 1 to 4 per scene. Generate All starts scenes about one second apart and skips scenes that already have images or are generating. Generate Selected for ticked rows.
- Prompt writing: one Claude call turns Visual, brand context, style masterprompt, active rules (5.8) and the product spec into the final image prompt. The editor can open the exact final prompt and save a sticky override. Reset removes it.
- References sent with each generation, in priority order, trimmed to the model's limit: product main photo (only when in frame), attached feedback images, character references, place or style references, then angle photos. If something is dropped, show a note naming what.
- Fewer images than requested: refill the missing count automatically, up to 2 extra rounds.
- **QA pass** after generation, advisory only: a vision call compares the image against the product photos and spec (product accuracy), checks anatomy and physical plausibility, and checks the scene's pinned rules. Show badges on failing images with the reason on hover. If every image of a scene fails product or anatomy, regenerate that scene once automatically. A failing rule check alone does not auto-retry.
- Content-filter block: reword only the offending wording, retry up to 2 times, show an orange note with what changed. After that, show a clear error.

### 5.7 Scene videos

- A video is made from a chosen image. Before any paid call, a **motion preflight** Claude call checks that the image can physically perform the requested motion, locks visible people, hands, objects and product details, plans one continuous action with a reachable end state, and stops with a plain message if the image contradicts the request or already shows the end state (offer to animate what the moment can still do).
- Optional **video idea** text per scene. Per-scene duration slider limited to the model's range. Default duration comes from word count and whether the line is spoken.
- Speaking: the brief records who speaks (everyone, nobody, some scenes). If nobody speaks, copy never enters the video prompt. Models with native audio can speak the line.
- Start and end frame mode for models that support it. Optional short transition clip between two scenes.
- Respect each model's prompt length limit with staged shortening: tighter rewrite, full rewrite, then drop visual description the image already carries. Show a note naming anything trimmed. Stop only when the core action plus spoken copy cannot fit.
- Poll with a long timeout (for example 20 minutes for video, 10 for images). Jobs run server side and survive tab closes and reloads.

### 5.8 Feedback, rules, history

- Per-scene feedback targets image, last frame or video. With an image selected the editor chooses **Tweak** (surgical edit, everything else identical, negations rewritten as positive descriptions) or **Rework** (Claude rewrites the prompt so only the named things change, then a diff check confirms untouched parts survived). Placement and "remove the frame" requests rebuild without feeding the old image back, and say so. The editor can attach a reference image to a feedback round.
- Video feedback first analyses the current clip, then rewrites the video prompt as a change against what the clip does.
- Feedback phrased as a question is rejected before spending anything, with a hint to rephrase it as a change.
- **Remember** toggle on feedback. When the same kind of remembered correction appears at least twice, a daily job distils it into a short DO or AVOID rule, scoped to org, brand, style or product, injected into later prompt writing. Rules decay without reinforcement and are capped per scope (about 20). A rules screen lets admins read, edit, pause and delete them.
- History strips per scene for images and videos. Regenerating images archives that scene's videos (an "archived videos" strip lets the editor restore them).

### 5.9 Library and downloads

- Save any image or video to the library. AI names and tags images. Search, filters (brand, type, time, favourites), rename, favourite, assign brand. Drag a library item into a scene, or set it as a character or style reference.
- Download all: one zip with files named by scene (`01.mp4`, `01-image-1.png`, transitions `01-02.mp4`), choice of everything, images only or videos only, built client side from signed URLs.
- Nothing generated is ever lost to provider URL expiry (see section 4 storage rule).

### 5.10 Cost, spend guard, errors

- **Price on every paid button**, computed from the price table and current settings. Per-ad running total. Estimates are labelled as estimates. Include LLM tokens in the total.
- **Spend guard.** Rolling 24 hour estimated spend per org. Warn threshold emails admins. Stop threshold sets `orgs.paused`, which blocks new paid jobs while in-flight jobs finish. Only an owner or admin can resume, and resuming is logged. Prices never block a click by themselves, only the guard does.
- **Error vocabulary** shown to users in plain words with a short code: `CONTENT_BLOCK`, `PROVIDER_ERROR`, `RATE_LIMIT`, `TIMEOUT`, `SPEND_LIMIT`, `KEY_INVALID`, `KEY_NO_CREDIT`, `VALIDATION`, `PROMPT_LOGIC`. `KEY_NO_CREDIT` pauses the job and resumes it when the customer fixes billing. Nothing already generated is lost.

### 5.11 Autopilot additions [NEW]

Port the rules (not the code) from the Hermes repo. Each becomes a versioned prompt or deterministic module.

1. **Hook pattern selection gate.** An editor picks the hook pattern from options before scripting continues.
2. **Visual director.** One Claude call over the whole script applies the nine editorial rules from Hermes (shot variety, energy arc, concretizing abstract sentences, and field-update rules that enforce routing changes downstream). Output is a validated per-sentence plan.
3. **Sentence routing.** Classify each sentence as `stock-friendly`, `generated`, `overlay-only` or `hybrid`. Evidence-type sentences (statistics, proof, claims that need a graphic) route to `overlay-only`. Only `generated` sentences get image and video generation prompts.
4. **B-roll sourcing.** Semantic search (TwelveLabs) using the full sentence text or the visual director's description, never generic query templates. Pexels as external source with 3 attempts, then a generated clip with a disclosed fallback. Duplicate detection by `clip_id` only. A supervisor step that can honestly reject clips (it must never be a no-op that accepts everything).
5. **Voiceover and captions.** ElevenLabs voiceover targeting 140 to 160 words per minute. Word-level timestamps from speech-to-text drive caption timing and cut points. Burned-in captions plus a downloadable SRT, kept inside platform safe zones (configurable, default keep key text out of roughly the bottom 20 percent and top 10 percent of a 9:16 frame). Never swap TTS provider silently: it is a fallback event, or a gate if the editor already approved the voice.
6. **Overlays.** Render text and graphic overlays headlessly (ADR: HyperFrames, Remotion or ffmpeg filters). If a styled overlay cannot render, show a fallback note and a gate. Do not degrade to plain text cards without disclosure.
7. **Assembly.** The render service composes a final 9:16 MP4 in a single pass: scenes, B-roll, voiceover, captions, overlays, CTA end card.
8. **Variant matrix.** N hooks by one shared body. Body scenes are generated once. Each hook plus the body plus the CTA assembles into its own MP4. Export all variants with clear names.
9. **Revision economics.** Each phase stores an `input_hash`. Changing an upstream input marks only dependent phases `stale`. Show the estimated cost of re-running them before the editor clicks. Later phases are cheaper to revise than earlier ones, so never reorder phases without evaluating revision cost.
10. **Editor style training.** Record editor corrections (cuts, pacing, overlay choices) as per-editor or per-org rules that the visual director reads. Late milestone.
11. **Performance loop.** Import ad metrics from Meta (hook rate, hold rate, ROAS) per variant, classify winners and losers, and distil brand-level DO and AVOID rules. Requires Meta app approval, so it is an ADR and a late milestone.

### 5.12 MCP endpoint (optional second interface)

- A remote MCP route in the Next.js app. Users create org-scoped bearer tokens (shown once, stored hashed, revocable, with a per-token spend cap).
- Tools: list brands, products and styles, create a storyboard, get an ad, quote then generate a scene image or video, list gates (read-only), request a scene regeneration. They call the same RPCs the UI uses, so RLS, the spend guard and rate limits apply unchanged.
- No `decide_gate` tool in v1. An agent must not approve its own gate. It summarises the gate and links to the approval card.
- The web UI must be fully usable without MCP.

## 6. Build plan

### M0: Decisions and scaffold

**Tasks.** Monorepo with `apps/web`, `services/render`, `packages/shared` (zod schemas, provider adapters, prompt registry), `supabase/`. CI with lint, typecheck, unit tests, pgTAP policy tests and Playwright. Environment management. Sentry. Write ADRs: workflow engine, render host, overlay renderer, test strategy for provider calls (recorded fixtures, no live calls in CI).

**Done when:** CI is green on a hello-world deploy to Vercel with a Supabase preview, and the ADRs are committed.

### M1: Schema, RLS, storage

**Tasks.** Migrations for section 4 with `is_org_member`. Security-definer RPCs for side effects (`create_ad`, `cancel_job`, `decide_gate`, `request_scene_regen`). Buckets and storage policies. Realtime on jobs, assets, scenes, gates, fallback_events, phase_runs.

**Done when:**

- A user in org A cannot read or write any row or storage object of org B.
- The browser role cannot write `gates.status`, `jobs`, `assets` or `org_secrets`.
- `supabase db reset` runs clean and all policy tests pass.

### M2: Access and setup UI

**Tasks.** Auth, orgs, invites, seats, brand and customer editors, brand architect chat, products with direct-to-Storage resumable uploads (Vercel body limit is about 4.5 MB, so never post files through a route), key screens with verify-before-save, setup checklist.

**Done when:**

- Sign in and session refresh work on a fresh deploy.
- A 200 MB video uploads from the browser to Storage.
- A bad Anthropic key is rejected on save, and the key never appears in any response, log or Realtime payload (grep test).
- Editing a URL to another org's record returns 404 and no data.

### M3: Provider layer, models, spend core

**Tasks.** Adapter interface and the kie.ai and fal.ai adapters. Model registry and `parameter_schema` driven settings. External task id persisted before polling. Content-block reword and retry, rate-limit backoff with jitter. `price_table`, `spend_events`, `org_spend_24h`, pause flag and the claim guard (paid jobs refused when paused).

**Done when:**

- Contract tests run against recorded fixtures with no live calls.
- A killed job resumes by polling its stored external id and never submits twice.
- Pushing a test org past the stop threshold pauses new paid jobs within one minute and lets running jobs finish.
- A live smoke script exists but is not part of CI.

### M4: Claude layer

**Tasks.** `llm.call({ task, schema, input })` wrapper: per-org key from Vault, tool-use structured output, zod validation, one retry with the validation error, token usage into `spend_events`, prompt registry with versions, one pinned model per task, input redaction in logs. Map Anthropic errors to `KEY_INVALID`, `KEY_NO_CREDIT`, `RATE_LIMIT`, `TIMEOUT`.

**Done when:**

- A malformed model answer triggers exactly one retry, then `needs_human`.
- An out-of-credit key pauses the job with `KEY_NO_CREDIT` and the job resumes after a new key is saved, with no lost work.
- Every call records model, prompt version, input hash and token cost.
- Golden-file tests pin task outputs against recorded responses.

### M5: Brief, plan, concept, storyboard (Studio)

**Tasks.** Brief form, optional dial-in, scene plan card with lock, concept and cast, storyboard generation, storyboard table with inline edit, split and merge, chat patching, scene rail and overview.

**Done when:**

- A locked plan is never re-split by later steps.
- A rule note survives regeneration and wins over an idea note.
- A chat patch changes only the cells it names and leaves existing images untouched.
- Splitting and merging renumber scenes without detaching assets.

### M6: Scene images

**Tasks.** Prompt writing, reference assembly with limits and priority, generation with refill, sticky prompt override, QA pass with advisory badges, auto-retry rule, content-block handling, history strips.

**Done when:**

- Asking for 4 images and receiving 3 triggers up to 2 refill rounds.
- A product-accuracy failure on every image triggers exactly one automatic regeneration, and a lock-only failure triggers none.
- Dropped references show a note naming what was dropped.
- Generated files are copied into own storage before the scene shows them.

### M7: Scene videos

**Tasks.** Motion preflight, video generation, per-scene duration, speaking rules, start and end frame, optional transitions, prompt length staging, archived videos and restore.

**Done when:**

- A contradictory request stops before any paid provider call and says why.
- Regenerating a scene's images archives its videos and they can be restored.
- A nobody-speaks brief never puts copy into any video prompt.
- A job reloaded mid-render reattaches and completes.

### M8: Feedback, library, downloads, spend UI

**Tasks.** Tweak and rework, attached reference images, negation rewriting, question rejection, remember toggle and daily distillation, rules screen, library, download zip, price on buttons, spend admin screen with resume, audit log.

**Done when:**

- Feedback phrased as a question is rejected with no spend.
- A remembered correction seen twice becomes a rule that appears in the next prompt, and decays when unreinforced.
- Regenerating scene 3 leaves scenes 1, 2 and 4 byte-identical and keeps scene 3's old versions restorable.
- The zip contains every asset with scene-based names.

### M9: Workflow engine and gates (Autopilot skeleton)

**Tasks.** Integrate the chosen workflow engine. Workflow run per ad with phases from a planned list, `phase_runs`, gates as rows with `decide_gate`, generic gate card plus specific cards, stepper driven by the planned phases (never a hardcoded list), fallback notes, cancel, health banner when the engine or render service is unreachable.

**Done when:**

- Two simultaneous approve clicks: exactly one wins, the other sees who decided.
- A forced timeout in an agent-style step ends in `needs_human`, never an approved gate.
- Reloading mid-run restores the exact state, and two tabs stay in sync.
- An unknown gate kind renders through the generic card.

### M10: Voice, captions, render service, assembly

**Tasks.** ElevenLabs voiceover, speech-to-text word timestamps, caption timing, render service with Postgres queue claim (`for update skip locked`) and heartbeat, assembly in one pass to a final MP4, CTA end card, SRT export.

**Done when:**

- A full test ad produces a playable 9:16 MP4 with voiceover and captions in sync.
- Killing the render service mid-job requeues it within 90 seconds and it resumes.
- Swapping the TTS provider without the editor's approval is impossible (test).
- Captions stay inside the configured safe zones (visual test).

### M11: Routing, B-roll, overlays, variants

**Tasks.** Hook pattern gate, visual director, sentence routing, B-roll search and supervisor, overlay rendering, hook by body variant matrix, revision economics (input hashes, stale marking, re-run cost).

**Done when:**

- Evidence-type sentences route to `overlay-only` (fixture test).
- Three hooks plus one body produce three MP4s while the body is generated only once.
- Changing the voiceover pace after approval marks only the dependent phases stale and shows the re-run cost first.
- An overlay that cannot render raises a visible fallback or gate, never a silent plain-text card.

### M12: Learning loops (late)

**Tasks.** Editor style training from corrections. Meta metrics import, winner and loser classification, brand-level rule distillation (ADR first, Meta app approval required).

**Done when:** a recorded editor correction changes the next visual director output in a test, and imported metrics produce reviewable draft rules that an admin must approve.

### M13: MCP, seats billing, hardening

**Tasks.** MCP route and token screen, Stripe seats, per-provider concurrency limits in the workflow engine, load test with several orgs, failure drills in CI, runbooks (worker offline, provider down, key out of credit), rollback, data export.

**Done when:**

- A leaked MCP token is revoked and its spend cap held.
- All failure drills in section 7 pass in CI.
- A saved provider key is never returned by any API response.

## 7. What ifs: drills the build must survive

1. **What if the customer's Anthropic key runs out of credit mid-storyboard?** The job pauses with `KEY_NO_CREDIT`, the UI says what to fix, and it resumes with no lost work.
2. **What if the image provider returns 3 of 4 images?** Refill up to 2 rounds, with a visible note if still short.
3. **What if the content filter blocks a prompt?** Reword and retry up to twice, show what changed, then a clear error.
4. **What if the editor closes the tab during a 10 minute render?** Reopening shows the same state and the job finishes.
5. **What if two editors edit one board?** Rows carry a `version`. A stale write is rejected with a clear message, not silently overwritten.
6. **What if provider result URLs expire?** Every asset is copied into own storage on completion. Test with an expired URL.
7. **What if the editor changes the voiceover pace after approving visuals?** Only dependent phases go stale, and the re-run cost is shown first.
8. **What if a model's output shape drifts after a provider update?** Pinned model per task, schema validation, one retry, then `needs_human`, plus golden-file tests.
9. **What if the product photos and the written brand context disagree?** Photos win. The spec is regenerated and human-editable.
10. **What if a runaway loop or leaked key burns money?** The spend guard pauses new paid jobs within a minute.
11. **What if the render service or workflow engine is down?** A visible banner appears and jobs wait. Nothing fails silently.
12. **What if an agent (MCP) tries to approve its own gate?** There is no tool for it. Only a human session can.
13. **What if the first three seconds do not hook?** The variant matrix makes testing hooks cheap, and the performance loop (M12) feeds results back as rules.

## 8. Knowledge to carry over from Hermes

Read `HERMES_PROJECT_CONTEXT.md` and the `ad-pipeline` skill in the Hermes repo if available. Port rules and prompts, not code. Verify each point.

- Sentence-level routing replaced section-level scene planning. Classes: stock-friendly, generated, overlay-only, hybrid. A `GRAPHIC_PROOF_SIGNALS` check routes evidence-type sentences to overlay-only.
- Phase 2 hook pattern selection is an editor gate. Phase 3a is the visual director with nine editorial rules. Phase 6b is an editor approval of generated clips.
- Semantic B-roll queries must use the full sentence or the director's description. Duplicate detection checks `clip_id` only (timestamp overlap checks produced false negatives).
- The supervisor must be a real quality gate. It was once a no-op that accepted everything.
- Voiceover target is 140 to 160 words per minute with word-level timestamps from speech-to-text.
- A past integrity audit found hand-authored QA gates, editor gates self-approved after timeout, TTS silently swapped, and overlays silently degraded to plain text cards. Section 2 rules 3 and 4 exist because of this. Treat each as a regression test.
- The phase reorder question (moving voiceover and overlays before the visual director) is unresolved. It changes revision economics. This spec does not decide it. Model phases as data so the order can change later.
- Orchestrator changes belong in code, not in markdown instructions. Markdown is not enforcement.

## 9. Open questions

Settle these before M0. Answer from the repo where you can and ask the human where you cannot.

- [ ] **Hermes repo access.** Where is it? You need it to port the visual director rules, hook patterns, sentence classes and routing rules.
- [ ] **Workflow engine.** Inngest or Trigger.dev? Check current pricing, step time limits and Vercel fit, then write the ADR.
- [ ] **Render host.** Is the existing VPS acceptable for the render service, or should it run elsewhere?
- [ ] **Launch providers.** Confirm kie.ai and fal.ai first for image and video, and which of xAI Grok, ElevenLabs, TwelveLabs, Pexels and HeyGen are needed at launch versus later. Which dev keys can the human supply?
- [ ] **Seed styles.** The human supplies Hermes's own style rules. Do not author seeds from any third party's masterprompts.
- [ ] **Overlay renderer.** HyperFrames, Remotion or ffmpeg filters? Check headless support and licence, then write the ADR.
- [ ] **Test fixture.** Use the first live test product (FisioRest) as the fixture. The human supplies brand context and photos.
- [ ] **Billing.** Is Stripe seat billing needed for the first pilot, or can seats be manual until M13?
- [ ] **Meta access.** Is a Meta app and ad account available for the M12 performance loop?
- [ ] **Phase order.** Confirm the current phase order stays as it is for the first version.

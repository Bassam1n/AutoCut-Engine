# ADR 002: Open M0 decisions — not yet resolved

## Status

Proposed (tracking only — each sub-decision needs the human's answer before
the milestone that depends on it starts)

## Context

Spec §9 lists open questions that must be settled before M0 is considered
done. Some have no answer we can derive from the repo or provider docs —
they're genuinely the human's call. This ADR exists so M0 doesn't silently
skip "write an ADR for every decision marked ADR" (spec §0) just because an
answer isn't available yet; it tracks the decision and is amended in place
once each is resolved.

## Decisions tracked here

1. **Workflow engine — Inngest vs Trigger.dev.** Blocks M9. Needs a
   pricing/step-time-limit/Vercel-fit comparison done close to when M9
   starts (pricing changes), not locked in now.
2. **Render host.** Spec §9 asks whether the existing Hostinger VPS is
   acceptable for the ffmpeg render service. Given the decision already made
   to stop depending on Hostinger as a runtime (see chat history —
   confirmed the whole point of this rebuild is a clean break), the
   working assumption is **no** — Fly.io or Railway instead, matching the
   spec's own requirement that the render service be "outbound only, no
   inbound port." Needs the human to confirm before M10.
3. **Overlay renderer — HyperFrames, Remotion, or ffmpeg filters.** Blocks
   M11. HyperFrames is the Hermes-era choice; worth re-evaluating headless
   support and licensing fresh rather than carrying it over by default,
   since the old pipeline's own audit found it was a loosely-integrated,
   never-directly-invoked reference skill rather than a load-bearing,
   battle-tested dependency.
4. **Launch providers beyond kie.ai/fal.ai.** Which of xAI Grok, ElevenLabs,
   TwelveLabs, Pexels, HeyGen ship at launch vs. later, and which dev keys
   the human can supply. Blocks M3 provider-adapter scope.
5. ~~**Seed styles.**~~ **Resolved.** 15 original platform styles seeded
   (`supabase/seed_styles.sql`), written fresh per spec's own rule — category
   selection was informed by a competitor style list the human shared (with
   the compiling party's stated permission to view it), but every
   masterprompt is original prose, confirmed with the human before writing
   anything. See the M2/M3 commit history around `seed_styles.sql`.
6. **Test fixture brand.** Spec names FisioRest (the original Hermes test
   client) as the first live fixture. Needs the human to supply brand
   context and product photos when M5/M6 testing starts.
7. **Billing timing.** Manual seat tracking until M13, or wire Stripe
   earlier for the pilot. Low urgency — doesn't block anything before M13.
8. **Meta app/ad account access.** Blocks M12 (performance loop) entirely;
   that milestone can't start without it.
9. **Phase order.** Spec §9 asks whether Autopilot's phase order should stay
   as Hermes had it. Spec §8 flags this as unresolved and explicitly says
   "model phases as data so the order can change later" rather than
   deciding now — so the schema (`phase_runs`, `input_hash`-based
   staleness) must not hardcode an order, but the actual sequence used at
   launch is still an open call for M9/M11.
10. ~~**Ad ownership — brand-level or product-level.**~~ **Resolved** (M5).
    Spec §4's original data model made `ads.product_id` nullable, allowing a
    brand-level ad with no specific product. The human corrected this when
    M5 routing came up: every ad in AutoCut is about a specific product,
    nested under it (`brand -> product -> ads`), not a brand-level concept.
    `ads.product_id` is now `not null` (migration
    `00000000000033_ads_require_product.sql`, applied against zero live
    rows, so no backfill was needed). Routes accordingly:
    `/org/[orgId]/brands/[brandId]/products/[productId]/ads`.
11. ~~**Scripts-first vs. brief-first.**~~ **Resolved** (M5). The initial M5
    shell made the manual Brief form the first Studio step. The human
    corrected this: since the editor already supplies brand/customer/
    product context elsewhere, the Studio should generate 3 full script
    variations (hook+body+CTA) up front from that context plus a required
    ad-length input, with the manual Brief form demoted to a fallback used
    only if the editor rejects all 3. Checked the old Hermes
    `visual_library` category system first to see if it had reusable
    per-category copy templates to port — it didn't (almost entirely empty
    placeholder scaffolding, and what little was populated modeled video/
    shot production patterns, not copywriting) — so `category_templates`
    is fresh content: one prose tone/angle brief per product category, not
    ported example copy. `products.category` became a fixed enum
    (migration `00000000000034_scripts_and_category.sql`) so it can key
    that table. New task `generate_ad_scripts` pinned to
    `claude-opus-5-5` (creative variance across 3 angles benefits from the
    stronger model more than pure extraction does).
12. ~~**Visual Director's place in the Studio flow.**~~ **Resolved** (M5).
    Checked the old Hermes pipeline: Visual Director was Phase 3a, a
    distinct, later phase that runs *after* scene-splitting, applying nine
    editorial rules to write a per-scene visual description, shot type,
    energy and routing — broader than, and separate from, the hook
    pattern's own "Visual Description" field (which is just one input to
    it, honored only for HOOK scenes). The human first proposed folding
    it into Concept & cast, but Concept & cast is ad-level (3 pitched
    directions + cast extraction) and never writes a per-scene visual —
    that's exactly Storyboard generation's job (spec §5.4 step 5: "Claude
    writes one row per scene with copy verbatim, a Visual description,
    and a Product cell"). Agreed: Visual Director's per-scene rules fold
    into the Storyboard generation prompt, not Concept & cast and not a
    separate step. Scene plan (step 3) stays pure text-splitting with no
    visual-direction responsibility.

13. ~~**Reusable brand-level cast members.**~~ **Resolved** (M5). Spec §4
    models cast as extracted fresh per concept (`cast_members`, one row per
    ad). The human asked for reusable "brand spokesperson" characters an
    org defines once and reuses across ads. New `brand_cast_members` table
    (org/brand-scoped, reusable). `extract_cast` is given the brand's
    existing cast library as context and matches a returning character by
    name/description before inventing a new one; `cast_members` gained a
    nullable `brand_cast_member_id` link. Required relaxing
    `assets.ad_id` to nullable with a parallel nullable `brand_id` (exactly
    one of the two set, enforced by a check constraint), since a reusable
    reference image can't be pinned to whichever ad first generated it.
14. **No async job runner exists yet (M9).** Cast reference image and
    character sheet generation need submit→poll→asset, but there's no
    background worker. Resolved for this batch by polling synchronously
    inline inside the triggering server action (fal.ai adapter, capped
    polling loop with a fixed delay) rather than building a real queue
    now. This is swappable for the real M9 job runner later without
    changing the calling contract (`generateReferenceImage()` just
    returns an asset id either way). Still open: M9 should replace the
    inline poll, not coexist with it.
15. ~~**Ad deletion: archive-only or real hard delete.**~~ **Resolved.**
    Spec §4's own stated rule ("Archive, never delete") already applies to
    generated assets. Extended the same rule to ads themselves rather
    than adding a destructive delete: `ads.archived` (soft-hide from the
    list) plus `ads.name` (nullable, for rename) — migration
    `00000000000037_ads_name_archive.sql`. No hard-delete path exists for
    ads; archiving never discards scripts/scenes/concepts/cast/spend
    history under an ad.
16. **In-app prompt editor fixed three real bugs found by live use:**
    cast extraction never passed the chosen style into `extract_cast` or
    into the cast-reference image prompt (cast wasn't actually
    style-grounded); the character-sheet and cast-regenerate actions used
    `void someAction(...)` fire-and-forget calls that silently swallowed
    every error, so a failed generation showed nothing happening; and the
    regenerate flow was a native `window.prompt()` with no way to see the
    current reference image or upload a replacement, despite spec saying
    "approve, or upload their own." Fixed in the same pass as the
    editor's new shared primitives (`components/modal.tsx`,
    `components/loading-indicator.tsx`), which also replaced `scene-plan-
    step.tsx`'s `window.prompt()` for idea/rule notes with the same
    modal, and added the Studio's own in-flow "Previous step" control
    plus a "Back to ads" link (`stepper.tsx`) alongside the existing
    `back-button.tsx`.
17. **Cost breakdown is per-ad, not per-org.** `spend_events.ad_id` and
    `kind` (already `llm:${task}` from `llm.call()`) were enough to group
    by pipeline step without new columns — `spend-data.ts`'s
    `groupSpendByKind()`. Image generation (`generate-reference-image.ts`)
    never recorded spend before this pass; it now calls
    `claim_paid_job`/`record_spend_event` the same way `llm.call()` does,
    priced from a new `price_table` row for `fal-ai/flux/dev`
    (`seed_price_table.sql`, fal.ai's documented $0.025/megapixel,
    applied to one generation — not a guessed number, but still an
    estimate per spec's own labeling convention for this table).
18. **In-app prompt editor is platform-admin-only**, matching
    `prompt_versions`' actual RLS (no insert/update policy for any role —
    genuinely service-role-write-only, confirmed by reading the table's
    own migration rather than assumed). New `save_prompt_version()` RPC
    (`00000000000038_prompt_editor.sql`), `SECURITY DEFINER` gated on
    `is_platform_admin()`, always **inserts** a new version and
    deactivates the previous one rather than overwriting — prompt history
    is load-bearing (`llm.call()` records which version every real call
    used), so an edit must never destroy what an earlier call actually
    ran against. Lives at `/platform-admin/prompts`, editing all 6 tasks
    with inline history.

19. **Cost breakdown was hiding itself when an ad had zero spend.**
    `CostBreakdown` returned `null` on an empty `spend_events` result —
    the user reported never seeing the feature at all, which was really
    "nothing has been generated yet on this ad" always short-circuiting
    before render. Fixed to always render with a "nothing generated yet"
    empty state instead of returning null.
20. **Image generation model is now editor-chosen per generation, not
    hardcoded to fal/flux-dev.** The user hit a real wall: cast reference
    generation failed whenever an org had a kie.ai key but no fal.ai
    key, because the code only ever checked for and used fal. kie.ai
    covers most of the image-model catalog an org might want (confirmed
    from the user's own kie.ai dashboard screenshot: Seedream, Z-image,
    Google, Flux-2, Grok Imagine, GPT Image, Topaz, Recraft, Ideogram,
    Qwen, Wan, 4o Image API, Flux Kontext API). `generateReferenceImage()`
    now takes a `provider`/`endpoint` instead of assuming fal; a new
    `ModelPicker` component (`components/model-picker.tsx`) lets the
    editor choose any registered image model, shows which providers
    have a key saved, and links to `/org/{orgId}/settings/keys?returnTo=
    {current path}` when the chosen provider has none — `keys-screen.tsx`
    now honors `returnTo` and redirects back after a successful save.
    No per-org "default model" preference was added (explicit choice —
    the user said per-generation with no memory is fine); each
    generation call defaults to fal/flux-dev when the editor hasn't
    picked, preserving existing behavior for callers that don't pass a
    model yet.
21. **kie.ai's per-model API docs aren't reachable by direct URL fetch**
    (confirmed: even z-image's own docs page, already used to build the
    existing registry entry, 404s now — the site appears to be a
    JS-rendered SPA that doesn't serve content to a plain HTML fetch).
    Two new kie models (`google/nano-banana`, `grok-imagine/image-to-
    image`) were added to the registry from real request payloads the
    user pasted directly, not guessed — confirmed the two models have
    genuinely different input shapes (nano-banana: `aspect_ratio` +
    `output_format`, no reference image field in the example given;
    grok-imagine/image-to-image: `image_urls` array, no `aspect_ratio`
    at all). This also surfaced a real bug in `KieAdapter.submit()`:
    `aspect_ratio` was unconditionally injected into every kie request
    regardless of model, and `referenceImageUrls` was never mapped to
    any field at all — fixed (`kie.ts`), both conditional on being
    genuinely provided, reference images mapped to `image_urls`. Only
    these two kie image models plus the two already-confirmed fal
    models are in the picker for now; the rest of the user's dropdown
    (Flux-2, Grok Imagine other entry points, Topaz, etc.) need their
    own confirmed payload before being added the same way.

22. **Expanded the kie.ai model registry using a competitor's (Trench)
    live model-config API** (`trenchosmtc.vercel.app/api/models`), which
    the user had legitimate access to and explicitly directed be used as
    source-of-truth — distinguished from the earlier "reference only,
    write fresh" rule (styles' masterprompts), since model/field names
    are objective facts about kie.ai's own public API, not Trench's
    original creative work. Per the user's explicit instruction, nothing
    was trusted without a real test call first, which caught a real
    discrepancy: Trench's config listed `submitPath: "/v1/generation/
    {model_id}"` + `statusPath: "/v1/task/{job_id}"` for several kie.ai
    models — both 404 against kie.ai's real API with a live key. The
    actual working kie.ai endpoint for every model is `/jobs/createTask`
    + `/jobs/recordInfo`, the one `KieAdapter` already implements —
    confirmed live: `gpt-image-2-5-flare-text-to-image` submitted and
    polled to `state: "generating"` with a real `creditsConsumed: 6.0`
    charge; `veo3_lite` and `v3-api` (Veo 3.1 Fast) both returned valid
    taskIds/recognized-model responses; `minimax-h3/image-to-video` and
    `bytedance/seedance-2-5` both returned real validation/credit errors
    (not "model not found"), confirming the slugs are genuine. Trench's
    `submitPath`/`statusPath` fields are that app's own internal gateway
    routing, not kie.ai's wire contract, and were not used — only the
    model names and `parameter_schema` tunable-field values came from
    Trench's data. 13 new models added (`gpt-image-2-5-flare`,
    `gpt-image-2-5-sunburst`, `nano-banana-2`, `gemini-omni-video`,
    `kling-3`, `minimax-h3`, `seedance-2`, `seedance-2-5`, `veo3-fast`,
    `veo3-lite`, `veo3-quality` — the two fal.ai-only entries from
    Trench's list, Nano Banana Pro and Sora 2, Kling 2.5, weren't added
    since this pass only tested/confirmed kie.ai endpoints).

23. **The $0.00 cost bug was price_table, not spend recording.**
    Image generation on any kie.ai model recorded a real spend_events
    row every time, but always at $0.0000 — price_table had no row for
    any kie model, and `generateReferenceImage()`'s lookup defaulted
    silently to `usd_est: 0` rather than failing loudly. Fixed by
    seeding real kie.ai per-model prices the user pasted directly from
    kie.ai's own pricing page (both image and video tables) —
    `seed_price_table.sql` now has rows for every image model in the
    registry (at that model's cheapest/default resolution tier) and
    every video model (at 720p, no native audio — each billed by
    whatever unit kie.ai actually bills by: per_image, per_second, or
    per_video). `z-image` has no confirmed price yet — it didn't appear
    by that name in the pasted pricing table, so no number was
    invented for it.
24. **The processing-animation visibility bug was a contrast bug, not a
    missing animation.** `LoadingIndicator`'s dots used `bg-accent` +
    `text-foreground-muted`, both low-contrast against an accent-colored
    button background — the animation was technically running but
    unreadable, which is why the user saw static "Regenerating..." text
    instead. Fixed to inherit `currentColor` from whatever container
    renders it. Per the user's request that this be global rather than
    patched case by case, added `components/async-button.tsx` — a
    `<button>` wrapper that takes `isPending`/`pendingLabel` and renders
    `LoadingIndicator` automatically, rather than every button
    hand-writing the `isPending ? <LoadingIndicator /> : label` ternary
    (which is how the contrast bug happened in the first place — nothing
    forced every call site to get the styling right). Rolled out to
    every button in `concept-cast-step.tsx` (the file the user's report
    came from); the other ~12 files using the old hand-written pattern
    still work correctly (just not yet migrated to the wrapper) and are
    a follow-up, not a regression.
25. **Added org-wide sidebar navigation** (Products, Create ad, Creative
    history) — until now every path to creating or finding a product/ad
    required navigating brand -> product -> ads by hand, with no
    shortcut and no cross-brand view. Products page
    (`/org/{orgId}/products`) lists every product grouped by brand, with
    an "add product" popup that picks a brand first, then reuses the
    existing per-brand new-product form (`/brands/{brandId}/products/
    new`) rather than building a second one. Creative history
    (`/org/{orgId}/creative-history`) lists every ad across every brand/
    product via a new `getAllOrgAds()` query (a real PostgREST embedded
    join against brands/products for display names, confirmed live
    against a local instance — `select=*,brands!inner(name),
    products!inner(name)`). "Create ad" is a sidebar button (not a page)
    that pops a brand -> product picker, then redirects straight to the
    existing new-ad style-picker page (`/ads/new`) — reuses the ad
    creation pipeline exactly as it already exists rather than building
    a parallel one.

26. **Both new sidebar popups (Products' "New product" and the "Create
    ad" button) were broken at runtime** — the button appeared to do
    nothing (Products) or the whole sidebar got stuck loading forever
    (Create ad). Root cause: `if (brands === null) { startTransition(...)
    }` was called directly inside the component body during render,
    not inside a `useEffect` or an event handler. Calling
    `startTransition` synchronously during render is not a legal React
    pattern — it re-fires on every render rather than once on mount,
    which is why the symptoms differed (stuck loading vs. a dead
    button) depending on exactly how each component's render cycle
    reacted to it. `PromptHistory` (`prompt-editor.tsx`), built
    correctly with `useEffect` from the start, never had this bug — a
    full-codebase grep after the fix confirmed no other component had
    the same anti-pattern. Fixed both to load via `useEffect` with a
    `cancelled` guard against the unmount/stale-response race.

## Consequences

Nothing in M1–M8 is blocked by any of these — schema, auth, provider
adapters, Claude layer, and Studio-mode UI don't depend on the workflow
engine, render host, overlay renderer, or Autopilot phase order. This ADR
exists so those decisions aren't forgotten by the time M9 onward actually
needs them, and so each is deliberately decided once, not re-litigated
piecemeal inside a later milestone's PR.

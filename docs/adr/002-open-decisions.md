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

## Consequences

Nothing in M1–M8 is blocked by any of these — schema, auth, provider
adapters, Claude layer, and Studio-mode UI don't depend on the workflow
engine, render host, overlay renderer, or Autopilot phase order. This ADR
exists so those decisions aren't forgotten by the time M9 onward actually
needs them, and so each is deliberately decided once, not re-litigated
piecemeal inside a later milestone's PR.

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

## Consequences

Nothing in M1–M8 is blocked by any of these — schema, auth, provider
adapters, Claude layer, and Studio-mode UI don't depend on the workflow
engine, render host, overlay renderer, or Autopilot phase order. This ADR
exists so those decisions aren't forgotten by the time M9 onward actually
needs them, and so each is deliberately decided once, not re-litigated
piecemeal inside a later milestone's PR.

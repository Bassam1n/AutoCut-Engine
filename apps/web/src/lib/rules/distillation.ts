/**
 * Pure helpers for the "feedback -> rules -> history" distillation job
 * (spec §5.8), kept here (not inlined in the Trigger.dev task) for the
 * same reason lib/feedback/target-asset.ts and lib/video/duration.ts
 * are pure modules — unit-testable without a database or a live
 * Claude call. The job itself (src/trigger/distill-feedback-rules.ts)
 * does all I/O; this file only decides SCOPE and DECAY MATH given
 * already-fetched rows.
 */

export type ScopeKind = "org" | "brand" | "style" | "product";

export type ScopeDecision = {
  scope: ScopeKind;
  /** null for org scope — matches rules.scope_id being nullable. */
  scopeId: string | null;
};

export type FeedbackScopeKeys = {
  brandId: string | null;
  styleId: string | null;
  productId: string | null;
};

/**
 * Decides how narrowly a cluster of remembered feedback should be
 * scoped, given the (brand, style, product) triple each member
 * feedback_events row resolves to (via ads.brand_id/style_id and
 * scenes.product_id — see distill-feedback-rules.ts's join). Spec
 * §5.8: rules are "scoped to org, brand, style or product."
 *
 * Decision rule (narrowest scope that covers every member):
 *   - every member shares the same non-null product_id -> "product"
 *   - else every member shares the same non-null style_id -> "style"
 *   - else every member shares the same non-null brand_id -> "brand"
 *   - else -> "org"
 *
 * Rationale: a correction that only ever showed up on one product
 * ("make the cap's logo bigger") shouldn't leak into every other
 * product's prompts just because it technically happened within one
 * brand — narrowest-common-scope keeps a rule's blast radius matched
 * to the evidence that produced it. A correction that recurs across
 * several products of the same style, or several styles of the same
 * brand, or even across brands/styles/products within the org (e.g.
 * "always give the main subject a visible smile"), graduates to the
 * next scope up rather than being silently dropped or duplicated once
 * per product.
 */
export function decideScope(members: FeedbackScopeKeys[]): ScopeDecision {
  if (members.length === 0) {
    return { scope: "org", scopeId: null };
  }

  const productIds = uniqueNonNull(members.map((m) => m.productId));
  if (productIds.length === 1) {
    return { scope: "product", scopeId: productIds[0] };
  }

  const styleIds = uniqueNonNull(members.map((m) => m.styleId));
  if (styleIds.length === 1) {
    return { scope: "style", scopeId: styleIds[0] };
  }

  const brandIds = uniqueNonNull(members.map((m) => m.brandId));
  if (brandIds.length === 1) {
    return { scope: "brand", scopeId: brandIds[0] };
  }

  return { scope: "org", scopeId: null };
}

function uniqueNonNull(values: (string | null)[]): string[] {
  return Array.from(new Set(values.filter((v): v is string => v !== null)));
}

// ---------------------------------------------------------------------
// Decay / reinforcement math. First-pass tunables, not spec-mandated
// numbers — documented here so they're one obvious place to retune
// rather than scattered through the job.
// ---------------------------------------------------------------------

/** Each time a rule is reinforced by a new matching remembered feedback instance, confidence rises by this much (capped at 1). */
export const REINFORCE_STEP = 0.15;

/** Each daily run a rule gets NO reinforcement, confidence decays by this much (floored at 0). A rule with no support for ~10 consecutive daily runs decays from the 0.5 default down past the deactivation floor. */
export const DECAY_STEP = 0.05;

/** Confidence at/below this value deactivates the rule (active = false) rather than deleting it — matches this project's "archive, never delete" convention (assets.archived, orgs.paused vs. deleted, etc.). An admin can still read/reactivate it manually from the rules screen. */
export const DEACTIVATION_THRESHOLD = 0.15;

/** Confidence given to a brand-new rule on creation — same default the rules table column already uses (migration 10), kept here as the named constant the job computes against. */
export const INITIAL_CONFIDENCE = 0.5;

/** "About 20" per spec — the cap applies per (org, scope, scope_id) triple. */
export const RULE_CAP_PER_SCOPE = 20;

/**
 * Clamps to [0, 1] AND rounds to 3 decimal places (matching the
 * confidence column's own numeric(4,3) precision) — without the
 * rounding, repeated +/- 0.05/0.15 floating-point arithmetic drifts
 * by fractions of a cent (e.g. 0.15 + 0.05 - 0.05 === 0.15000000000000002
 * in IEEE 754 double precision), which would make a value landing
 * exactly AT DEACTIVATION_THRESHOLD incorrectly compare as still
 * active. Caught by a real unit test, not assumed.
 */
export function clampConfidence(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  return Math.round(clamped * 1000) / 1000;
}

export type DecayInput = {
  confidence: number;
  active: boolean;
  /** Whether this rule was reinforced in THIS run (i.e. at least one new, not-yet-attached remembered feedback instance matched it). */
  reinforced: boolean;
};

export type DecayResult = {
  confidence: number;
  active: boolean;
  reinforcedCountDelta: 0 | 1;
};

/**
 * One rule's confidence update for one daily run. Reinforcement always
 * wins over decay for that run (a rule that just got fresh evidence
 * doesn't also decay the same day). An already-inactive rule is left
 * alone by this function — reactivation is a manual admin action
 * (spec: "a rules screen lets admins ... pause" — the inverse, un-
 * pausing, is the same admin-only action in reverse), never automatic,
 * so a rule that decayed out doesn't silently spring back to life
 * from the job alone.
 */
export function applyDecayStep(input: DecayInput): DecayResult {
  if (!input.active) {
    return { confidence: input.confidence, active: false, reinforcedCountDelta: 0 };
  }

  if (input.reinforced) {
    const confidence = clampConfidence(input.confidence + REINFORCE_STEP);
    return { confidence, active: true, reinforcedCountDelta: 1 };
  }

  const confidence = clampConfidence(input.confidence - DECAY_STEP);
  const active = confidence > DEACTIVATION_THRESHOLD;
  return { confidence, active, reinforcedCountDelta: 0 };
}

export type CapDecision =
  | { action: "create" }
  | { action: "create_after_deactivating"; deactivateRuleId: string }
  | { action: "skip_at_cap" };

/**
 * Spec §5.8: rules are "capped per scope (about 20)." Chosen behavior
 * when a new rule would be created and the scope is already at the
 * cap: DO NOT auto-deactivate an existing rule to make room. Reasoning
 * (documented per the task's instructions, not spec-mandated):
 *
 *   - Auto-deactivating "the lowest-confidence existing rule" to make
 *     room sounds reasonable but silently discards a rule an admin
 *     may be relying on, the exact moment a genuinely new pattern
 *     emerges — the two are unrelated events, and conflating them
 *     means a rule can vanish from prompt-writing context with zero
 *     admin visibility into why, violating spec's framing that the
 *     rules screen (admin-controlled) is what reads/edits/pauses/
 *     deletes rules — not an unattended batch job.
 *   - A low-confidence existing rule is exactly the kind of thing the
 *     decay mechanic (applyDecayStep) already retires on its own,
 *     without needing the cap to force the issue — it'll cross
 *     DEACTIVATION_THRESHOLD naturally within a few unreinforced runs.
 *   - So: at cap, skip creating the new rule and leave it for next
 *     run. If the underlying pattern keeps recurring, the next
 *     candidate cluster will include this run's un-attached feedback
 *     plus more new instances, so nothing is lost — it just waits for
 *     either natural decay to open a slot, or an admin to prune
 *     manually from the rules screen (exactly what the spec names
 *     that screen for).
 *
 * Only `existingActiveCount` is needed today; a future policy change
 * to auto-deactivate the lowest-confidence existing rule would take
 * the scope's existing rules (sorted by confidence ascending) as a
 * second parameter, returning "create_after_deactivating" with that
 * rule's id instead — the CapDecision union already has that variant
 * ready, this function just never produces it yet.
 */
export function decideCapAction(existingActiveCount: number): CapDecision {
  if (existingActiveCount < RULE_CAP_PER_SCOPE) {
    return { action: "create" };
  }
  return { action: "skip_at_cap" };
}

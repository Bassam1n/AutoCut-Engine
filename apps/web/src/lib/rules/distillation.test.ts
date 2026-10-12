import { describe, it, expect } from "vitest";
import {
  decideScope,
  applyDecayStep,
  decideCapAction,
  clampConfidence,
  REINFORCE_STEP,
  DECAY_STEP,
  DEACTIVATION_THRESHOLD,
  RULE_CAP_PER_SCOPE,
} from "./distillation";

describe("decideScope", () => {
  it("scopes to product when every member shares the same product_id", () => {
    const result = decideScope([
      { brandId: "b1", styleId: "s1", productId: "p1" },
      { brandId: "b1", styleId: "s1", productId: "p1" },
    ]);
    expect(result).toEqual({ scope: "product", scopeId: "p1" });
  });

  it("scopes to style when products differ but style is shared", () => {
    const result = decideScope([
      { brandId: "b1", styleId: "s1", productId: "p1" },
      { brandId: "b1", styleId: "s1", productId: "p2" },
    ]);
    expect(result).toEqual({ scope: "style", scopeId: "s1" });
  });

  it("scopes to brand when both products and styles differ but brand is shared", () => {
    const result = decideScope([
      { brandId: "b1", styleId: "s1", productId: "p1" },
      { brandId: "b1", styleId: "s2", productId: "p2" },
    ]);
    expect(result).toEqual({ scope: "brand", scopeId: "b1" });
  });

  it("scopes to org when brands differ", () => {
    const result = decideScope([
      { brandId: "b1", styleId: null, productId: null },
      { brandId: "b2", styleId: null, productId: null },
    ]);
    expect(result).toEqual({ scope: "org", scopeId: null });
  });

  it("scopes to org when every key is null across members", () => {
    const result = decideScope([
      { brandId: null, styleId: null, productId: null },
      { brandId: null, styleId: null, productId: null },
    ]);
    expect(result).toEqual({ scope: "org", scopeId: null });
  });

  it("does not let one member's null product force org scope if products otherwise agree", () => {
    // Only one distinct non-null product id across all members ->
    // still product-scoped, a null entry doesn't count as "a second
    // distinct product."
    const result = decideScope([
      { brandId: "b1", styleId: "s1", productId: "p1" },
      { brandId: "b1", styleId: "s1", productId: "p1" },
      { brandId: "b1", styleId: "s1", productId: null },
    ]);
    expect(result).toEqual({ scope: "product", scopeId: "p1" });
  });

  it("falls back to org scope for an empty member list", () => {
    expect(decideScope([])).toEqual({ scope: "org", scopeId: null });
  });
});

describe("clampConfidence", () => {
  it("clamps above 1 down to 1", () => {
    expect(clampConfidence(1.4)).toBe(1);
  });
  it("clamps below 0 up to 0", () => {
    expect(clampConfidence(-0.3)).toBe(0);
  });
  it("leaves an in-range value unchanged", () => {
    expect(clampConfidence(0.42)).toBe(0.42);
  });
});

describe("applyDecayStep", () => {
  it("leaves an already-inactive rule untouched", () => {
    const result = applyDecayStep({ confidence: 0.1, active: false, reinforced: true });
    expect(result).toEqual({ confidence: 0.1, active: false, reinforcedCountDelta: 0 });
  });

  it("reinforcement increases confidence by REINFORCE_STEP and counts as reinforced", () => {
    const result = applyDecayStep({ confidence: 0.5, active: true, reinforced: true });
    expect(result.confidence).toBeCloseTo(0.5 + REINFORCE_STEP, 10);
    expect(result.active).toBe(true);
    expect(result.reinforcedCountDelta).toBe(1);
  });

  it("reinforcement caps confidence at 1", () => {
    const result = applyDecayStep({ confidence: 0.95, active: true, reinforced: true });
    expect(result.confidence).toBe(1);
  });

  it("no reinforcement decreases confidence by DECAY_STEP", () => {
    const result = applyDecayStep({ confidence: 0.5, active: true, reinforced: false });
    expect(result.confidence).toBeCloseTo(0.5 - DECAY_STEP, 10);
    expect(result.reinforcedCountDelta).toBe(0);
  });

  it("decaying below the deactivation threshold flips active to false", () => {
    const justAboveThreshold = DEACTIVATION_THRESHOLD + DECAY_STEP / 2;
    const result = applyDecayStep({ confidence: justAboveThreshold, active: true, reinforced: false });
    expect(result.confidence).toBeLessThanOrEqual(DEACTIVATION_THRESHOLD);
    expect(result.active).toBe(false);
  });

  it("decaying to exactly the threshold deactivates (threshold is exclusive of staying active)", () => {
    const result = applyDecayStep({
      confidence: DEACTIVATION_THRESHOLD + DECAY_STEP,
      active: true,
      reinforced: false,
    });
    expect(result.confidence).toBeCloseTo(DEACTIVATION_THRESHOLD, 10);
    expect(result.active).toBe(false);
  });

  it("staying comfortably above the threshold after decay keeps the rule active", () => {
    const result = applyDecayStep({ confidence: 0.9, active: true, reinforced: false });
    expect(result.active).toBe(true);
  });
});

describe("decideCapAction", () => {
  it("creates when under the cap", () => {
    expect(decideCapAction(RULE_CAP_PER_SCOPE - 1)).toEqual({ action: "create" });
  });

  it("skips at the cap", () => {
    expect(decideCapAction(RULE_CAP_PER_SCOPE)).toEqual({ action: "skip_at_cap" });
  });

  it("skips over the cap", () => {
    expect(decideCapAction(RULE_CAP_PER_SCOPE + 5)).toEqual({ action: "skip_at_cap" });
  });
});

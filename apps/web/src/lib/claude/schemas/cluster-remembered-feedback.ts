import { z } from "zod";

/**
 * Output schema for "cluster_remembered_feedback" — spec §5.8: "When
 * the same kind of remembered correction appears at least twice, a
 * daily job distils it into a short DO or AVOID rule." Matching "the
 * same kind of correction" by free-form text (e.g. "make her smile
 * more" / "she needs a bigger smile" / "the smile isn't warm enough")
 * genuinely needs semantic judgment, not keyword/substring matching —
 * this is one real Claude call per distillation batch, not a
 * heuristic.
 *
 * Input shape (see distill-feedback-rules.ts): a list of candidate
 * feedback instances, each with a stable `index` (0-based position in
 * the input array the caller gave) and its free-form `text`. The
 * model groups instances expressing the same underlying correction
 * into clusters, and for every cluster with 2+ members proposes the
 * actual rule text — generalized beyond any one instance's exact
 * wording, not a verbatim copy of one member.
 *
 * Every input index must appear in exactly one cluster (including
 * clusters of size 1 — those are simply not yet rule-worthy, the
 * caller filters on member count, not this schema). Requiring every
 * index to be placed (rather than letting the model silently drop
 * ones it finds ambiguous) keeps this call's output a total partition
 * of the input, which the caller validates against the actual input
 * size before trusting it.
 */
export const ClusterRememberedFeedbackSchema = z.object({
  clusters: z.array(
    z.object({
      member_indices: z
        .array(z.number().int())
        .describe(
          "0-based indices (matching the input list's `index` field) of every feedback instance that expresses the same underlying correction as this cluster. Every cluster must have at least 1 member; a cluster of 1 just isn't a rule candidate yet — the caller decides that, not you."
        ),
      kind: z
        .enum(["do", "avoid"])
        .describe(
          "'do' when the correction asks for something to be present/true (e.g. a warmer smile, better lighting). 'avoid' when it's fundamentally about removing or preventing something (e.g. don't show visible logos, avoid harsh shadows). Pick based on what reads more naturally as an instruction, not the literal grammar of any one instance."
        ),
      rule_text: z
        .string()
        .describe(
          "A short, concrete, GENERALIZED rule statement starting with 'DO:' or 'AVOID:' matching `kind` — written to cover the underlying pattern across every member of this cluster, not copied verbatim from any single instance's wording. Example: several instances like 'make her smile more', 'she needs a bigger smile', 'the smile isn't warm enough' should produce something like 'DO: give the main subject a warm, visible smile' — not a direct quote of any one of them. One sentence, phrased as an instruction a prompt writer can follow directly."
        ),
    })
  ),
});

export type ClusterRememberedFeedback = z.infer<typeof ClusterRememberedFeedbackSchema>;

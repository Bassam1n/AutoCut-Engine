"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrgMember } from "@/lib/auth";
import { llmCall } from "@/lib/claude/call";
import { LlmCallError } from "@/lib/claude/types";
import { DialItInQuestionsSchema, type DialItInQuestions } from "@/lib/claude/schemas/dial-it-in";
import { getAd } from "./ads-data";
import { getCustomers } from "@/app/org/[orgId]/brands/[brandId]/customers/customers-data";

export type QuestionsResult = { ok: true; questions: DialItInQuestions["questions"] } | { ok: false; error: string };
export type ActionResult = { ok: true } | { ok: false; error: string };

export async function generateDialInQuestions(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string
): Promise<QuestionsResult> {
  await requireOrgMember(orgId);

  const ad = await getAd(orgId, productId, adId);
  if (!ad) return { ok: false, error: "Ad not found." };

  const customers = await getCustomers(orgId, brandId);

  let output;
  try {
    const result = await llmCall({
      task: "generate_dial_in_questions",
      schema: DialItInQuestionsSchema,
      orgId,
      input: {
        brief: ad.brief,
        saved_customer_profiles: customers.map((c) => c.profile),
      },
    });
    output = result.output;
  } catch (err) {
    if (err instanceof LlmCallError) return { ok: false, error: err.message };
    throw err;
  }

  return { ok: true, questions: output.questions };
}

/**
 * Called once the editor finishes (or skips through) the question
 * flow. Viewer-topic answers save as a new customer profile on the
 * brand (spec: "ends with a customer card the editor can save").
 * Ad-topic answers fold into the ad's brief.idea as readable free
 * text — no dedicated schema exists for "world"/"look"/"speaks on
 * camera" etc., and this keeps them flowing into Scene plan/Concept
 * generation exactly the way any other idea text already does,
 * without a speculative schema addition nothing downstream reads yet.
 */
export async function saveDialInAnswers(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string,
  customerName: string,
  viewerAnswers: Record<string, string>,
  adAnswers: Record<string, string>
): Promise<ActionResult> {
  await requireOrgMember(orgId);

  const supabase = await createClient();

  if (customerName.trim() && Object.keys(viewerAnswers).length > 0) {
    const { error: customerError } = await supabase.from("customers").insert({
      org_id: orgId,
      brand_id: brandId,
      name: customerName.trim(),
      profile: {
        age_range: viewerAnswers.viewer_age,
        pains: viewerAnswers.viewer_pain,
        desired_outcome: viewerAnswers.viewer_outcome,
      },
    });
    if (customerError) return { ok: false, error: customerError.message };
  }

  if (Object.keys(adAnswers).length > 0) {
    const ad = await getAd(orgId, productId, adId);
    if (!ad) return { ok: false, error: "Ad not found." };

    const summary = Object.values(adAnswers).filter(Boolean).join(". ");
    const existingIdea = ad.brief.idea ? `${ad.brief.idea} ` : "";

    const { error: adError } = await supabase
      .from("ads")
      .update({ brief: { ...ad.brief, idea: `${existingIdea}${summary}`.trim() } })
      .eq("org_id", orgId)
      .eq("id", adId);
    if (adError) return { ok: false, error: adError.message };
  }

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads/${adId}`);
  return { ok: true };
}

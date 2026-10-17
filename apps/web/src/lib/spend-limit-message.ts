/**
 * claim_paid_job() (supabase/migrations/00000000000031_spend_guard.sql)
 * raises a raw Postgres exception shaped like:
 *   org_paused: Spend guard: 24h spend $22.00 crossed the $20.00 stop threshold
 * Every paid-job call site (llm.call(), generateReferenceImage(),
 * run-provider-job.ts) calls claim_paid_job() before spending
 * anything and previously let that raw string reach the end user
 * verbatim — meaningful to an engineer, meaningless to an editor who
 * just clicked "Generate." This strips the "org_paused: " prefix
 * Postgres adds (claim_paid_job's own `raise exception 'org_paused:
 * %', ...`) and falls back to a generic plain-language message for
 * any other shape, so a non-paused-org failure from this RPC (e.g.
 * "org not found") never gets mistaken for the expected case either.
 *
 * Deliberately NOT guarded with "server-only" — run-provider-job.ts
 * (a Trigger.dev task, not bundled by Next.js) imports this too, and
 * that guard package doesn't resolve outside the Next.js bundler (see
 * that file's own comment on why it constructs its Supabase client
 * directly instead of importing lib/supabase/service.ts). This is a
 * pure string-formatting function with no server-only dependency of
 * its own, so the guard would only break one of its two callers for
 * no safety benefit.
 */
export function spendLimitMessage(rawMessage: string): string {
  const unpaid = rawMessage.match(/^org_unpaid:\s*([\s\S]*)$/);
  if (unpaid) {
    return `Generation is off because ${unpaid[1]}. Your agency owner can renew it with AutoCut; your work is still here.`;
  }
  if (/^org_storage_full:/.test(rawMessage)) {
    return "Your agency's storage is full, so new images and videos can't be saved. Your owner can permanently delete archived ads to free space, or move to a bigger plan.";
  }
  if (/^brand_archived:/.test(rawMessage)) {
    return "This brand is archived, so nothing new can be generated for it. An admin can unarchive it from the brand's settings.";
  }
  if (/^org_suspended:/.test(rawMessage)) {
    return "This agency's account is suspended. Contact AutoCut to restore it.";
  }
  const match = rawMessage.match(/^org_paused:\s*([\s\S]*)$/);
  if (match) {
    return `Spend paused: ${match[1]}. An org owner or admin can resume spending from Settings → Spend & guard.`;
  }
  return "This org's spend guard blocked the request. An org owner or admin can check Settings → Spend & guard.";
}

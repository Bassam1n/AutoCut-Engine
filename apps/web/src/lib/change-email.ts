import "server-only";
import { createServiceClient } from "./supabase/service";

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Changes a user's sign-in email through the Auth admin API. Callers
 * must already have authorized the change (org owner editing an admin
 * or user via assert_owner_can_manage_member, or a platform admin):
 * this uses the service role and does no permission check itself.
 *
 * email_confirm: true applies the change immediately rather than
 * waiting for the person to click a confirmation link, since the
 * change is made on their behalf. Sign-in is by magic link, so the new
 * address is what they'll use from the next login.
 */
export async function changeUserEmail(
  userId: string,
  rawEmail: string
): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }

  const service = createServiceClient();
  const { error } = await service.auth.admin.updateUserById(userId, {
    email,
    email_confirm: true,
  });

  if (error) {
    const taken = /already|registered|exists/i.test(error.message);
    return {
      ok: false,
      error: taken ? "That email is already used by another account." : error.message,
    };
  }

  return { ok: true, email };
}

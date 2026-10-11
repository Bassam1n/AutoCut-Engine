import "server-only";
import { createClient } from "@/lib/supabase/server";

export type ApiKeyProvider = "anthropic" | "kie" | "fal" | "elevenlabs" | "twelvelabs" | "pexels";
export type OAuthProvider = "xai" | "heygen";

export type OrgSecretRow = {
  provider: ApiKeyProvider;
  last4: string;
  verified_at: string | null;
  created_at: string;
};

export async function getOrgSecrets(orgId: string): Promise<OrgSecretRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_org_secrets", {
    target_org_id: orgId,
  });
  if (error) throw new Error(error.message);
  return data ?? [];
}

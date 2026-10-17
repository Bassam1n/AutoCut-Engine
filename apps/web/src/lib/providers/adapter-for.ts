// No "server-only" guard: imported from Trigger.dev tasks too.
import { FalAdapter } from "./fal";
import { HiggsfieldPlanAdapter } from "./higgsfield-plan-adapter";
import { KieAdapter } from "./kie";
import type { MediaProvider, ProviderAdapter } from "./types";

/**
 * The one place that maps a media provider name to its adapter. `secret`
 * is the stored value for that provider (an API key, or for
 * higgsfield_plan the account's login tokens). `persistSecret` saves an
 * updated secret; only higgsfield_plan uses it, to keep refreshed logins.
 */
export function adapterFor(
  provider: MediaProvider,
  secret: string,
  persistSecret?: (secret: string) => Promise<void>
): ProviderAdapter {
  switch (provider) {
    case "kie":
      return new KieAdapter(secret);
    case "fal":
      return new FalAdapter(secret);
    case "higgsfield_plan":
      return new HiggsfieldPlanAdapter(secret, persistSecret);
  }
}

/** Plan-credit providers spend the client's own subscription, not a priced per-call rate. */
export function isPlanCreditProvider(provider: string): boolean {
  return provider === "higgsfield_plan";
}

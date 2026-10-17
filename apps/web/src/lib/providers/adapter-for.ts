// No "server-only" guard: imported from Trigger.dev tasks too.
import { FalAdapter } from "./fal";
import { HiggsfieldAdapter } from "./higgsfield";
import { KieAdapter } from "./kie";
import type { MediaProvider, ProviderAdapter } from "./types";

/** The one place that maps a media provider name to its adapter. */
export function adapterFor(provider: MediaProvider, apiKey: string): ProviderAdapter {
  switch (provider) {
    case "kie":
      return new KieAdapter(apiKey);
    case "fal":
      return new FalAdapter(apiKey);
    case "higgsfield":
      return new HiggsfieldAdapter(apiKey);
  }
}

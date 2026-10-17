"use client";

import { useSearchParams } from "next/navigation";
import { buttonVariants } from "@/components/button";

/**
 * EXPERIMENTAL "Connect Higgsfield account": signs in with the client's
 * higgsfield.ai account (OAuth) so generation could spend their plan
 * credits instead of a separate API balance. For now this only tests
 * whether Higgsfield accepts AutoCut's sign-in and lists its tools;
 * generation still uses the Higgsfield API key above.
 */
export function HiggsfieldPlanCard({
  orgId,
  brandId,
  connected,
  verified,
}: {
  orgId: string;
  brandId: string;
  connected: boolean;
  verified: boolean;
}) {
  const searchParams = useSearchParams();
  const result = searchParams.get("higgsfield_plan");
  const message = searchParams.get("message");
  const tools = searchParams.get("tools");
  const connectHref = `/api/higgsfield-plan/connect?orgId=${encodeURIComponent(orgId)}&brandId=${encodeURIComponent(brandId)}`;

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <span className="font-medium">Higgsfield account (plan credits)</span>
          <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">Beta test</span>
        </div>
        {connected && (
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
              verified ? "bg-accent-soft text-accent" : "bg-danger-soft text-danger"
            }`}
          >
            {verified ? "Connected" : "Signed in, not verified"}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-foreground-muted">
        Sign in with a higgsfield.ai account to test using its plan credits. Generation still uses the
        Higgsfield API key above for now.
      </p>
      {/* A plain link, not a fetch: the connect route redirects the browser to Higgsfield's login. */}
      <a href={connectHref} className={`${buttonVariants.primary} mt-3 inline-flex`}>
        {connected ? "Reconnect Higgsfield account" : "Connect Higgsfield account"}
      </a>

      {result === "connected" && (
        <p className="mt-3 text-sm text-accent">
          Connected. Higgsfield shared {tools ? tools.split(",").length : 0} tools
          {tools ? `: ${tools.split(",").join(", ")}` : "."}
        </p>
      )}
      {result === "connected_no_tools" && (
        <p className="mt-3 text-sm text-danger">Signed in, but listing Higgsfield&apos;s tools failed: {message}</p>
      )}
      {result === "error" && <p className="mt-3 text-sm text-danger">{message ?? "Connecting failed."}</p>}
    </div>
  );
}

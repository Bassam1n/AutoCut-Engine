"use client";

import { useSearchParams } from "next/navigation";
import { buttonVariants } from "@/components/button";

/**
 * Connects this brand to a higgsfield.ai account (OAuth sign-in), so the
 * Higgsfield models in the model picker generate on that account's plan
 * credits. The connect and callback routes live in /api/higgsfield-plan.
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
  const connectHref = `/api/higgsfield-plan/connect?orgId=${encodeURIComponent(orgId)}&brandId=${encodeURIComponent(brandId)}`;

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">Higgsfield account</span>
        {connected && (
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
              verified ? "bg-accent-soft text-accent" : "bg-danger-soft text-danger"
            }`}
          >
            {verified ? "Connected" : "Not verified"}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-foreground-muted">
        Higgsfield models generate on this account&apos;s plan credits. Sign in with the higgsfield.ai account
        that should pay for this brand&apos;s images and videos.
      </p>
      {/* A plain link, not a fetch: the connect route redirects the browser to Higgsfield's sign-in. */}
      <a href={connectHref} className={`${connected ? "btn-secondary" : buttonVariants.primary} mt-3 inline-flex`}>
        {connected ? "Reconnect" : "Connect Higgsfield account"}
      </a>
      {result === "connected" && <p className="mt-3 text-sm text-accent">Higgsfield account connected.</p>}
      {result === "error" && (
        <p className="mt-3 text-sm text-danger">{message ?? "Connecting Higgsfield failed."}</p>
      )}
    </div>
  );
}

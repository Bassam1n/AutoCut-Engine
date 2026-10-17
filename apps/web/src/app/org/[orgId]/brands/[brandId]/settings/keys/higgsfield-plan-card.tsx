"use client";

import { useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { buttonVariants } from "@/components/button";
import {
  inspectHiggsfieldPlan,
  testHiggsfieldPlanImage,
  type InspectPlanResult,
  type PlanTestResult,
} from "./keys-actions";

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
  const [inspect, setInspect] = useState<InspectPlanResult | null>(null);
  const [isInspecting, startInspecting] = useTransition();
  const [test, setTest] = useState<PlanTestResult | null>(null);
  const [isTesting, startTesting] = useTransition();
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
      {connected && (
        <button
          type="button"
          disabled={isInspecting}
          onClick={() => startInspecting(async () => setInspect(await inspectHiggsfieldPlan(orgId, brandId)))}
          className="btn-secondary ml-2 mt-3"
        >
          {isInspecting ? "Checking..." : "Check Higgsfield tools"}
        </button>
      )}
      {connected && (
        <button
          type="button"
          disabled={isTesting}
          onClick={() => {
            if (!window.confirm("Generate ONE small test image using this Higgsfield account's plan credits?")) return;
            startTesting(async () => setTest(await testHiggsfieldPlanImage(orgId, brandId)));
          }}
          className="btn-secondary ml-2 mt-3"
        >
          {isTesting ? "Generating test image..." : "Test one image on plan credits"}
        </button>
      )}
      {test && !test.ok && <p className="mt-3 text-sm text-danger">{test.error}</p>}
      {test?.ok && (
        <div className="mt-3 flex flex-col gap-1 break-words text-xs text-foreground-muted">
          <p className={test.stage === "generated" ? "text-sm text-accent" : "text-sm text-danger"}>
            {test.stage === "generated" && "Test image generated on plan credits."}
            {test.stage === "preflight_failed" && "The free cost check was refused, so nothing was spent."}
            {test.stage === "submit_failed" && "The generation request was refused."}
            {test.stage === "not_finished" && "Submitted, but the image wasn't ready yet."}
          </p>
          <p>Balance before: {test.balanceBefore}</p>
          {test.cost && <p>Cost check: {test.cost}</p>}
          {test.balanceAfter && <p>Balance after: {test.balanceAfter}</p>}
          {test.jobId && <p>Job: {test.jobId}</p>}
          {test.detail && <p>Details: {test.detail}</p>}
          {test.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={test.imageUrl} alt="Higgsfield test image" className="mt-2 w-40 rounded-lg border border-border" />
          )}
        </div>
      )}
      {inspect?.ok && (
        <p className="mt-3 text-sm text-accent">
          Read {inspect.toolCount} tools. Generation tools found: {inspect.generationTools.join(", ") || "none"}.
        </p>
      )}
      {inspect && !inspect.ok && <p className="mt-3 text-sm text-danger">{inspect.error}</p>}

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

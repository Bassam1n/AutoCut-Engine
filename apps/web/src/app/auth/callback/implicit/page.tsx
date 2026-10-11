import { Suspense } from "react";
import { ImplicitFlowBridge } from "../implicit-bridge";

export default function ImplicitCallbackPage({
  searchParams,
}: PageProps<"/auth/callback/implicit">) {
  return (
    <Suspense fallback={null}>
      <Resolved searchParams={searchParams} />
    </Suspense>
  );
}

async function Resolved({
  searchParams,
}: {
  searchParams: PageProps<"/auth/callback/implicit">["searchParams"];
}) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "/";
  return <ImplicitFlowBridge next={next} />;
}

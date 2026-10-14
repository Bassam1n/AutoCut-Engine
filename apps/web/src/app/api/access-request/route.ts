import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Receives "request access" submissions from the marketing site
 * (autocutengine.app), which is a static site on another origin — hence
 * the CORS handling. The visitor is anonymous, so the insert uses the
 * service client; access_requests has no anon RLS path by design.
 * Platform admins work the queue at /platform-admin/requests.
 */

const ALLOWED_ORIGINS = new Set([
  "https://autocutengine.app",
  "https://www.autocutengine.app",
  "https://autocutengine-site.vercel.app",
]);

function corsHeaders(origin: string | null): HeadersInit {
  const allowed =
    origin && (ALLOWED_ORIGINS.has(origin) || origin.startsWith("http://localhost"))
      ? origin
      : "https://autocutengine.app";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("origin")) });
}

export async function POST(request: Request) {
  const headers = corsHeaders(request.headers.get("origin"));

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400, headers });
  }

  const text = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
  const agency = text(body.agency, 200);
  const name = text(body.name, 200);
  const email = text(body.email, 320);
  const note = text(body.note, 2000);
  const editors = Number.parseInt(String(body.editors ?? ""), 10);

  // Honeypot: real visitors never fill this hidden field. Pretend success.
  if (text(body.website, 10) !== "") {
    return NextResponse.json({ ok: true }, { headers });
  }

  if (!agency || !name || !email.includes("@")) {
    return NextResponse.json(
      { ok: false, error: "Fill in your agency, name and a valid email." },
      { status: 400, headers }
    );
  }

  const supabase = createServiceClient();

  // One pending request per email is enough; repeat submits read as success.
  const { data: existing } = await supabase
    .from("access_requests")
    .select("id")
    .eq("email", email.toLowerCase())
    .eq("status", "new")
    .limit(1)
    .maybeSingle();

  if (!existing) {
    const { error } = await supabase.from("access_requests").insert({
      agency,
      name,
      email: email.toLowerCase(),
      editors: Number.isNaN(editors) ? null : Math.min(Math.max(editors, 1), 500),
      note: note || null,
    });
    if (error) {
      return NextResponse.json(
        { ok: false, error: "Something went wrong. Try again in a minute." },
        { status: 500, headers }
      );
    }
    await notifyPlatformSlack(agency, name, email, note);
  }

  return NextResponse.json({ ok: true }, { headers });
}

/**
 * Best-effort ping to the platform's own Slack channel (not any
 * agency's webhook): set PLATFORM_SLACK_WEBHOOK_URL in Vercel to turn
 * it on. A Slack outage never fails the submission — the row is
 * already stored and visible in /platform-admin/requests.
 */
async function notifyPlatformSlack(agency: string, name: string, email: string, note: string) {
  const url = process.env.PLATFORM_SLACK_WEBHOOK_URL;
  if (!url || !url.startsWith("https://hooks.slack.com/")) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text:
          `New access request: *${agency}*\n` +
          `${name} · ${email}${note ? `\n> ${note.slice(0, 300)}` : ""}\n` +
          `${(process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "")}/platform-admin/requests`,
      }),
    });
  } catch (err) {
    console.error("access-request Slack ping failed", err);
  }
}

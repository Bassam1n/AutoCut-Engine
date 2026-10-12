# AutoCut Engine

<!-- trigger: verifying Vercel git integration after reconnect -->


A web app for video ad agencies. An editor picks a brand, a product and a
visual style, writes a brief (or drafts one from a product URL), and gets a
storyboard, per-scene images and videos, voiceover, captions and a finished
MP4, with human approval gates.

Studio mode is interactive and editor-driven. Autopilot mode chains the same
building blocks end to end from a brief, stopping only at human approval
gates.

See `docs/HERMES_WEB_SPEC_V2.md` for the full build spec (milestones M0–M13,
architecture, data model, and the ground rules every change must satisfy).

## Repo layout

```
apps/web/           Next.js app — UI, server actions, MCP route, webhooks
services/render/     Dockerized ffmpeg render service (assembly, captions, overlays)
packages/shared/      zod schemas, provider adapters, prompt registry — shared by web and render
supabase/             Postgres migrations, RLS policies
docs/adr/             Architecture decision records
```

## Status

M0 (decisions and scaffold) — in progress.

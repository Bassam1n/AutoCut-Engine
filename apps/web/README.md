# apps/web

Next.js App Router application. UI, server actions, the MCP route, and
provider webhooks. See `../../docs/HERMES_WEB_SPEC_V2.md` for the feature
spec and `../../docs/adr/001-nextjs-cache-components.md` for how this app
handles Next.js 16's Cache Components rendering model — read that ADR
before writing any page that reads a session, cookie, or search param.

## Local development

```bash
npm install
npm run dev
```

Opens at `http://localhost:3000`.

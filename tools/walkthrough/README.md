# AutoCut product walkthrough recorder

Records a Loom-style walkthrough of the whole app by driving the **live**
app (studio.autocutengine.app) with Playwright: a fake cursor with click
ripples, an orange highlight ring, burned-in captions and chapter title
cards. Each chapter records separately, then `assemble.mjs` stitches them
into one 1080p MP4 plus a YouTube-style chapter list.

- `lib.mjs`: sign-in, overlay, eased cursor, the `director()` helpers.
- `record.mjs`: the chapters (what the video shows, in order).
- `assemble.mjs`: ffmpeg normalise + concat, writes `out/chapters.txt`.
- Output: `out/autocut-walkthrough.mp4` (git-ignored).

## Demo data (already seeded in production, migration-free)

Agency **Northbeam Studio (demo)** (`de000000-0000-4000-8000-000000000001`), plan Pro, 10 seats.

| User | Role | Brands |
|---|---|---|
| maya.owner@demo.autocutengine.app | Owner (ad creation on) | all |
| leo.admin@demo.autocutengine.app | Admin | all |
| ana.editor@demo.autocutengine.app | User | Northbeam Cold Brew, Lumen Skin |
| sam.editor@demo.autocutengine.app | User | Peak Form |
| platform.demo@demo.autocutengine.app | (platform admin, granted only while recording) | n/a |

Brands: Northbeam Cold Brew, Lumen Skin, Peak Form (each with products and a
customer profile). Board: default columns, 8 tasks across every stage.

The `demo.autocutengine.app` addresses have no mailbox; nothing is emailed.
All demo users share one password that is never committed or stored: at
the start of each recording session, set a fresh random one with SQL
(`update auth.users set encrypted_password = crypt('<new>', gen_salt('bf'))
where email like '%@demo.autocutengine.app';`) and pass it as
`DEMO_PASSWORD` to `record.mjs`. Sign-in for recording is a password grant
written into `@supabase/ssr` cookies (see `lib.mjs`); the app itself stays
magic-link only.

## Requirements (cloud environment settings)

1. **Allowed domains:** `studio.autocutengine.app`,
   `wbxwkuevmjawtcnbsbfg.supabase.co` (and optionally `api.trigger.dev`).
2. **Provider keys** are NOT environment variables (those are visible to
   everyone using the environment). The platform admin
   (bassam.aziz01+m2test@gmail.com) was made a temporary owner of the demo
   agency and pastes the keys into
   https://studio.autocutengine.app/org/de000000-0000-4000-8000-000000000001/settings/keys
   in their own browser. Chapter 03 then shows them as "already connected".
   After recording, remove that temporary membership:
   `delete from org_members where org_id = 'de000000-0000-4000-8000-000000000001' and user_id = (select id from auth.users where email = 'bassam.aziz01+m2test@gmail.com');`

## Run

```bash
cd tools/walkthrough
node record.mjs            # all chapters → out/raw/NN-*.webm
node record.mjs 07 08      # re-record only some chapters
node assemble.mjs          # → out/autocut-walkthrough.mp4 + out/chapters.txt
```

Long generation steps (video models take minutes) are not filmed while
waiting: a chapter ends after clicking Generate, the recorder polls in an
unrecorded page until the result is ready, then the next chapter opens on
the finished result with a "a few minutes later" caption.

## Before and after recording

- Grant the demo platform admin just before recording the platform chapter:
  `insert into platform_admins (user_id) values ('de000000-0000-4000-8000-0000000000a5');`
- **Revoke it right after:**
  `update platform_admins set revoked_at = now() where user_id = 'de000000-0000-4000-8000-0000000000a5';`
- When the video is final, suspend the demo agency from Platform admin (or
  keep it as a sales demo workspace) and remove the demo provider keys.

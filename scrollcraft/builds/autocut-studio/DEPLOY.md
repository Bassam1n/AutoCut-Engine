# Putting the site on your GoDaddy domain

The site is static: plain HTML, CSS and JS with no build step and no server code. Any static host can serve it. The files that go live are:

```
index.html  site.css  site.js  scrollcraft.css  scrollcraft.js  assets/
```

Everything else in this folder (`lab/`, `BRIEF.md`, `package.json`, `node_modules/`) is development only.

## Before you publish

1. **Set the email that receives access requests.** In `site.js`, change `CONTACT_EMAIL` (top of the file). In `index.html`, change `mailto:hello@example.com` on the `<form>` to the same address. The form opens the visitor's email app with the request filled in. It does not send anything by itself. To collect requests without email, swap the form for a form service later (Formspree, Netlify Forms, Tally).
2. **Make the social preview image absolute.** In `index.html`, change `content="assets/img/og.png"` to `content="https://yourdomain.com/assets/img/og.png"` once you know your domain.

## Option A (recommended): Vercel, domain stays at GoDaddy

Free, HTTPS included, redeploys on every push to GitHub.

1. Sign in at vercel.com with GitHub and choose **Add New → Project**. Import `bassam1n/autocut-engine`.
2. Set **Root Directory** to `scrollcraft/builds/autocut-studio`. Set **Framework Preset** to **Other**. Leave the build command and output directory empty. Deploy.
3. In the project, open **Settings → Domains** and add `yourdomain.com` and `www.yourdomain.com`. Vercel then shows the exact DNS records it wants. Use the values it shows you. Today they are usually:
   - `A` record, name `@`, value `76.76.21.21`
   - `CNAME` record, name `www`, value `cname.vercel-dns.com` (newer projects may show a project-specific value; use that instead)
4. In GoDaddy: **My Products → your domain → DNS** (Manage DNS).
   - Delete or edit the existing `A` record for `@` (often it points to GoDaddy's "Parked" page) so it has the value from step 3.
   - Edit the existing `CNAME` for `www` (often `@` or a GoDaddy host) to the value from step 3.
   - If **Forwarding** is switched on for the domain, switch it off.
   - Leave `MX` and `TXT` records alone, or your email stops working.
5. Wait. DNS usually updates within minutes and occasionally takes up to 48 hours. Vercel's Domains page turns green and issues the HTTPS certificate automatically.

## Option B: Netlify drag and drop, no GitHub needed

1. Zip only the live files listed at the top (or the folder minus `lab/` and `node_modules/`).
2. At app.netlify.com choose **Add new site → Deploy manually** and drop the folder.
3. **Domain management → Add a domain** and enter your domain. Netlify shows its records, usually an `A` record for `@` to `75.2.60.5` and a `CNAME` for `www` to `yoursite.netlify.app`.
4. Enter those in GoDaddy DNS exactly as in Option A step 4.

## Option C: GoDaddy's own web hosting

Only if you already pay for a GoDaddy hosting plan (cPanel). The domain then needs no DNS changes.

1. GoDaddy **My Products → Web Hosting → Manage → cPanel Admin → File Manager**.
2. Open `public_html`, upload the live files and the `assets` folder (keep the same structure), and make sure `index.html` sits directly inside `public_html`.
3. Turn on the free SSL certificate in the hosting dashboard so the site loads on `https://`.

## After it is live

- Open the site on a real phone (iPhone Safari and Android Chrome). Headless tests passed, but a real device was not checked.
- Submit the access form once and confirm the email draft opens addressed to you.
- Check `https://yourdomain.com` and `https://www.yourdomain.com` both load.

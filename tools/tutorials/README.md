# Interactive tutorials

Click-through walkthroughs shown on **Tutorials** in the app
(`/org/<org>/tutorials`): a screenshot of the real app with a pulsing
hotspot on what to click, and a tooltip explaining it.

- `tutorials.mjs`: the scripts. Each step says where to go, what to point
  at, and what the tooltip says; `click: true` steps continue when the
  viewer clicks the hotspot. `roles` decides who sees a tutorial.
- `capture.mjs`: drives the live demo agency with Playwright, saves
  `apps/web/public/tutorials/<id>/NN.jpg` and the hotspot positions in
  `apps/web/src/lib/tutorials/tutorials.json`.

Nothing is submitted while capturing: steps only navigate and open
menus or modals. Ad tutorials move the demo ad's saved step and put it
back on Export at the end.

## Re-capture (after UI changes)

Set a fresh demo password first (see `tools/walkthrough/README.md`), then:

```bash
cd tools/tutorials
DEMO_PASSWORD=... node capture.mjs                 # everything
DEMO_PASSWORD=... node capture.mjs ad-pipeline     # one tutorial
```

In a cloud session, prefix with `NODE_USE_ENV_PROXY=1
NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt` so Node goes through the
proxy. Any step that can't find its target is reported as FAILED and
skipped; fix its selector in `tutorials.mjs` and re-run that tutorial.

// Tutorial scripts for capture.mjs. Each step:
//   go      path to open first (optional; otherwise stays on the page)
//   before  extra setup before the screenshot (open a menu, scroll)
//   target  the element the hotspot points at
//   click   true when the viewer continues by clicking the target;
//           capture.mjs clicks it too, to reach the next screen
//   after   cleanup after the screenshot (close a modal)
//   title / body  what the tooltip says
// roles: who sees the tutorial (owner, admin, editor).

const ORG = (d) => `/org/${d.orgId}`;
const BRAND = (d) => `${ORG(d)}/brands/${d.brands.northbeam}`;
export const DEMO_AD_ID = "848d4737-6281-436e-972d-527aea05b6f0";
const AD = (d) => `${BRAND(d)}/products/acea4cd3-0e1d-4e54-9267-b7bd816d02db/ads/${DEMO_AD_ID}`;
const MODAL = (p) => p.locator("div.fixed.inset-0.z-50 > div");

/** Opens the demo ad on one of its steps (from Export, every earlier step is clickable). */
const openAdStep = (tab) => async (p, h) => {
  await h.setAdStep("export");
  await p.goto(h.app + AD(h.demo), { waitUntil: "domcontentloaded" });
  await p.waitForLoadState("networkidle").catch(() => {});
  if (tab) await stepTab(tab)(p).first().click();
};
const stepTitle = (p) => p.locator("h2").first();

const link = (name) => (p) => p.getByRole("link", { name, exact: true });
const button = (name) => (p) => p.getByRole("button", { name });
const heading = (name) => (p) => p.getByRole("heading", { name });
const field = (selector) => (p) => p.locator(selector);
const stepTab = (name) => (p) => p.getByRole("button", { name: new RegExp(`^(✓|\\d+)\\s*${name}`) });
const escape = async (p) => p.keyboard.press("Escape");

export const TUTORIALS = [
  {
    id: "workspace-tour",
    title: "Tour your workspace",
    description: "The board, brands, products, library, styles and rules: what each part of AutoCut is for.",
    category: "Getting started",
    roles: ["owner", "admin", "editor"],
    appPath: "/org/{org}/board",
    steps: [
      { go: (d) => `${ORG(d)}/board`, target: link("Board"), title: "Your board", body: "Every ad your agency is working on is a card here, from To do to Done. Filter by person or brand at the top." },
      { target: heading(/In review/), title: "Work moves left to right", body: "When an editor finishes an ad it moves to In review. Approving it sends it to Done; requesting changes sends it back." },
      { target: button("+ Create ad"), title: "Start a new ad", body: "Every ad starts here. You pick the brand and product, and AutoCut walks you through the rest." },
      { target: link("Brands"), click: true, title: "Open Brands", body: "Click Brands to see your clients." },
      { target: (p) => p.getByRole("link", { name: /Northbeam Cold Brew/ }), title: "One workspace per client", body: "Each brand keeps its own audience, products, recurring cast and provider keys, so clients never mix." },
      { target: link("Products"), click: true, title: "Open Products", body: "Click Products." },
      { target: (p) => p.getByRole("link", { name: /Oat Latte Cold Brew/ }), title: "Everything you advertise", body: "Each product has its facts, size and reference photos. Generated images use them to get the product right." },
      { target: link("Library"), click: true, title: "Open the Library", body: "Click Library." },
      { target: heading(/Saved images/), title: "Your best work, reusable", body: "Save strong images and videos here and drop them into any future ad. Library items are never auto-deleted." },
      { target: link("Styles"), click: true, title: "Open Styles", body: "Click Styles." },
      { target: (p) => p.getByRole("heading").first(), title: "Looks you can pick", body: "A style is a visual look, like Creator UGC or Anatomy Glow. Every style shows a preview of what it produces." },
      { target: link("Rules"), click: true, title: "Open Rules", body: "Click Rules." },
      { target: (p) => p.getByRole("heading").first(), title: "AutoCut learns from feedback", body: "When your team gives the same feedback more than once, it becomes a rule, so the mistake isn't repeated in new ads." },
      { target: (p) => p.locator("aside button").first(), title: "Notifications", body: "The bell tells you when something needs your review, was approved, or needs changes." },
      { target: (p) => p.locator('aside a[href$="/profile"]'), title: "Your profile", body: "Change your name and photo here, and switch between light and dark mode below. You're all set." },
    ],
  },
  {
    id: "set-up-brand",
    title: "Set up a client brand",
    description: "Add a brand and fill in the context that keeps every script and image on brand.",
    category: "Getting started",
    roles: ["owner", "admin"],
    appPath: "/org/{org}/brands/new",
    steps: [
      { go: (d) => `${ORG(d)}/brands`, target: link("New brand"), click: true, title: "Add a brand", body: "Click New brand to add a client." },
      { target: field("input#name"), title: "Name it", body: "Use the client's brand name. You can add a logo link below it." },
      { target: field("#audience"), title: "Who it speaks to", body: "Describe the buyer in a sentence or two. Scripts and hooks are written for this audience." },
      { target: field("#tone"), title: "How it sounds", body: "Warm, direct, playful: the voice every script is written in." },
      { target: field("#product_facts"), title: "Facts that must stay true", body: "Anything that must never be misstated, like ingredients, sizes or guarantees." },
      { target: field("#visual_feel"), title: "How it looks", body: "Colours, light and mood. This steers every generated image." },
      { target: field("#never_generate"), title: "What the frame should contain", body: "Describe what should be in the shot instead of listing don'ts. Image models tend to draw whatever a 'no' list names." },
      { target: field("#claims_rules"), title: "Claims rules", body: "What can and can't be claimed. Scripts follow this, which keeps ads compliant." },
      { go: (d) => `${BRAND(d)}/customers`, target: button("Add audience profile"), title: "Audience profiles", body: "Add the brand's buyer types, with their problems and the words they use. Scripts are written to them." },
      { target: link("Cast library"), title: "Recurring characters", body: "The cast library keeps the same people looking the same across every ad for this brand." },
      { target: link("Settings"), title: "Brand keys", body: "A brand can use its own provider keys, so its AI costs are billed separately from your other clients." },
    ],
  },
  {
    id: "add-product",
    title: "Add a product and photos",
    description: "Product facts, real size and reference photos: the three things that make generated images accurate.",
    category: "Getting started",
    roles: ["owner", "admin", "editor"],
    appPath: "/org/{org}/products",
    steps: [
      { go: (d) => `${ORG(d)}/products`, target: button("New product"), title: "New product", body: "Add products here or from inside a brand." },
      { target: (p) => p.getByRole("link", { name: /Oat Latte Cold Brew/ }), click: true, title: "Open a product", body: "Click a product to see what it holds." },
      { target: field('input[placeholder="One line describing the product"]'), title: "What it is", body: "One clear line. Claude uses it in every script and image prompt for this product." },
      { target: field('input[placeholder^="e.g. \\"15cm tall"]'), title: "Real size", body: "This keeps the product the right size next to hands and people in generated images." },
      { target: heading("Reference photos"), title: "Reference photos", body: "Upload 3 or 4 clean photos from different angles, on a plain background. Every image of this product is generated from them." },
      { target: link("Ads"), title: "Its ads", body: "Every ad made for this product lives here, including archived ones." },
    ],
  },
  {
    id: "ad-pipeline",
    title: "Make an ad, step by step",
    description: "From brief to export: scripts, scene plan, cast, storyboard, images, voiceover and videos.",
    category: "Creating ads",
    roles: ["owner", "admin", "editor"],
    appPath: "/org/{org}/board",
    steps: [
      { go: (d) => `${ORG(d)}/board`, target: button("+ Create ad"), click: true, title: "Create an ad", body: "Click Create ad." },
      { target: MODAL, title: "Pick the brand and product", body: "Choose the brand, then the product. Next you pick the ad's main style and AutoCut opens the ad.", after: escape },
      { before: openAdStep(null), target: (p) => stepTab("Scripts")(p).first().locator("xpath=ancestor::div[count(.//button)>=9][1]"), title: "Every ad has these steps", body: "Here's a finished ad. Steps run left to right; once a step is done you can click back to it any time." },
      { before: openAdStep("Scripts"), target: stepTitle, title: "1. Scripts", body: "Set the length and Claude writes three script variants from the brand, audience and product. Pick one or regenerate." },
      { before: openAdStep("Fine-tune the brief"), target: stepTitle, title: "2. Fine-tune the brief", body: "Tighten the hook, the offer and the tone before the script is split into scenes." },
      { before: openAdStep("Scene plan"), target: stepTitle, title: "3. Scene plan", body: "The script becomes short scenes, each with its line. Split, merge or reorder them, then lock the plan." },
      { before: openAdStep("Concept & cast"), target: stepTitle, title: "4. Concept and cast", body: "Pick a creative concept and the people in it. Cast members keep the same face in every scene." },
      { before: openAdStep("Storyboard"), target: stepTitle, title: "5. Storyboard", body: "Each scene gets a shot description and its own style. Claude can suggest the best style per scene." },
      { before: openAdStep("Scene images"), target: stepTitle, title: "6. Scene images", body: "Generate 1 to 4 images per scene and keep the best. You see the cost before anything runs." },
      { before: openAdStep("Voiceover"), target: stepTitle, title: "7. Voiceover", body: "Record the script in a voice you choose, with captions timed to it." },
      { before: openAdStep("Scene videos"), target: stepTitle, title: "8. Scene videos", body: "Each image becomes a short clip. Videos take a few minutes and keep running if you close the tab." },
      { before: openAdStep(null), target: button("Download zip"), title: "9. Export", body: "Download everything or pick exactly what you want, then finish the cut in your editing tool. That's the whole ad." },
    ],
  },
  {
    id: "styles-and-claude",
    title: "Mix styles and ask Claude",
    description: "Give each scene its own look, let Claude suggest styles, and ask Claude to write a scene's image prompt.",
    category: "Creating ads",
    roles: ["owner", "admin", "editor"],
    appPath: null,
    steps: [
      { before: openAdStep("Storyboard"), target: button(/Suggest styles/), title: "Let Claude suggest styles", body: "Claude reads every scene and suggests the best style for each, with a reason. Nothing changes until you apply it." },
      { target: (p) => p.getByRole("button", { name: /^Scene style/ }), click: true, title: "A style per scene", body: "Each scene can have its own look, like a UGC hook, then a 3D anatomy cutaway, then a clean product shot. Click to change it." },
      { target: (p) => p.getByRole("listbox"), title: "Pick by preview", body: "Every style shows what it looks like. Pick one for just this scene, or keep the ad's style.", after: escape },
      { before: openAdStep("Scene images"), target: field('textarea[placeholder^="e.g. \\"Scene 3"]'), title: "Ask Claude in plain words", body: "Say what a scene should show, like \"scene 6 is the CTA, write a prompt for it\". Claude writes it in that scene's style." },
      { target: button("Edit prompt"), click: true, title: "See a scene's prompt", body: "Each scene card has its image prompt. Click Edit prompt." },
      { target: (p) => p.getByText("Final image prompt (sticky override)"), title: "The prompt lands here", body: "Claude's prompt appears in this box. Edit it if you like, save, then regenerate the scene. Nothing is generated until you do." },
    ],
  },
  {
    id: "review-approve",
    title: "Review and approve",
    description: "How ads move through review, and how reviewers request changes scene by scene.",
    category: "Team and review",
    roles: ["owner", "admin"],
    appPath: "/org/{org}/board",
    steps: [
      { go: (d) => `${ORG(d)}/board`, target: (p) => p.getByRole("button", { name: /Barrier serum testimonial cut/ }), click: true, title: "Open a task in review", body: "Click a card in In review." },
      { target: link("Review now"), title: "Open the review", body: "A task in review links to its ad and review round. Review now opens it.", after: escape },
      { go: (d) => `${ORG(d)}/review/0e348a5d-2dad-468f-9ea2-b3a3ce87a6bc`, target: (p) => p.getByText("Request changes", { exact: true }).first().locator("xpath=.."), title: "Review scene by scene", body: "Approve each scene or flag it with a note. One click sends the whole review: everything approved moves the task to Done, any flag sends it back to Revisions." },
      { before: openAdStep(null), target: (p) => p.getByText(/Changes requested/).first(), title: "The editor sees exactly what to fix", body: "Flagged scenes come back highlighted, with the reviewer's note already in the feedback box." },
    ],
  },
  {
    id: "team-and-roles",
    title: "Invite your team",
    description: "Invite editors and admins, choose their role, and decide which brands they work on.",
    category: "Team and review",
    roles: ["owner"],
    appPath: "/org/{org}/team",
    steps: [
      { go: (d) => `${ORG(d)}/team`, target: (p) => p.getByRole("heading").first(), title: "Your team", body: "Everyone in your agency, their role and their brands." },
      { target: (p) => p.locator('input[type="email"]').first(), title: "Invite by email", body: "Enter their work email. They get a sign-in link; if email is slow you can share a link instead." },
      { target: (p) => p.locator("select").first(), title: "Pick a role", body: "Admins manage brands and see spend. Users work on the brands you assign them." },
    ],
  },
  {
    id: "keys-spend-plan",
    title: "Keys, spend and your plan",
    description: "Connect your AI providers, set spend limits, and see your plan's usage.",
    category: "Settings",
    roles: ["owner"],
    appPath: "/org/{org}/settings/keys",
    steps: [
      { go: (d) => `${ORG(d)}/settings/keys`, target: (p) => p.getByText("Anthropic", { exact: true }).first(), title: "Connect your providers", body: "AutoCut runs on your own AI keys, so you pay providers directly with no markup. Anthropic writes, kie.ai or fal.ai make images and video." },
      { go: (d) => `${ORG(d)}/settings/spend`, target: (p) => p.getByRole("heading").first(), title: "Spend guard", body: "AutoCut tracks the last 24 hours of spend. It warns you at one limit and pauses generation at another, until an owner resumes it." },
      { go: (d) => `${ORG(d)}/settings/plan`, target: heading("Usage"), title: "Plan and usage", body: "Your plan, renewal date, and how many seats, brands and storage you're using." },
    ],
  },
];

-- M4: seeds the example_extraction task's prompt into prompt_versions
-- so llm.call({task: "example_extraction", ...}) has a real active
-- row to read. This is a minimal, genuinely useful first task (not a
-- placeholder with no purpose): structured extraction of claims/
-- benefits/objections/audience from free text, which spec §5.4 names
-- directly ("a Claude call extracts claims, benefits, objections and
-- audience into a draft brief") — the real M5 task this will become
-- once M5 builds the brief form; seeded now so M4's golden-file test
-- has a real task to pin against, not a throwaway one.
--
-- Not a numbered migration — re-runnable content, same as
-- seed_styles.sql/seed_models.sql.
insert into public.prompt_versions (task, version, body, active)
values (
  'example_extraction',
  1,
  'Extract structured information from the following product or offer description. Identify: the product''s key claims (what it does or promises), its main benefits (why a customer would want it), likely objections a skeptical buyer might raise, and a short description of the target audience. Be concise and factual — only extract what the text actually supports, never invent claims the text does not make.',
  true
)
on conflict (task, version) do update
  set body = excluded.body,
      active = excluded.active;

-- M5: script-first flow. Given brand context, customer profile,
-- product facts, a category tone brief and a target length, produce
-- exactly 3 distinct full scripts (hook + body + CTA). The editor
-- picks one of the 3, or falls back to writing a brief by hand if
-- none fit — this prompt is only ever asked for 3 candidates, never
-- one "best" answer, since variety across angles is the point.
insert into public.prompt_versions (task, version, body, active)
values (
  'generate_ad_scripts',
  1,
  'You are writing short-form video ad scripts. Using the brand context, target customer profile, product facts and category guidance given in the input, write exactly three distinct full scripts for a video ad of the given target length in seconds. Each script has a hook (the opening line(s), written to stop the scroll in the first couple seconds), a body (the main copy — claims, benefits, proof, written to actually fit speaking pace for the target length), and a cta (a short closing call to action). The three scripts must take genuinely different angles from each other (e.g. different emotional hook, different proof point, different framing) — do not submit three near-duplicates with reworded openers. Only make claims the given product facts actually support. Match the tone guidance given for the product''s category. Write copy meant to be spoken aloud, not read as text — contractions, natural rhythm, no bullet-point phrasing.',
  true
)
on conflict (task, version) do update
  set body = excluded.body,
      active = excluded.active;

-- M5: Scene plan step. Splits the ad's chosen script (hook + body +
-- cta, already written) into scenes per the style's cutting rule.
-- fast_cut styles split roughly one sentence per scene; whole_take
-- styles (UGC-paced) keep full continuous takes together rather than
-- chopping every sentence into its own scene. The model must not
-- drop or invent copy — every word of the script must land in
-- exactly one scene, in order.
insert into public.prompt_versions (task, version, body, active)
values (
  'generate_scene_plan',
  1,
  'You are splitting a finished video ad script into scenes for production. The script has a hook, a body and a cta section, each given as text in the input. Split the FULL combined script into an ordered list of scenes, tagging each scene with which section it came from (hook_1, hook_2 or hook_3 if there are multiple hook lines, body, or cta). Follow the given cutting rule exactly: "fast_cut" means split roughly one sentence per scene (a sentence with a clear internal beat may become two scenes); "whole_take" means keep each section''s full text together as one continuous scene unless it is unusually long, in which case split only at a natural pause. Never drop, summarize, or invent copy — every word of the input script must appear verbatim in exactly one scene''s copy, in the original order. For each scene, estimate how many seconds it takes to speak that scene''s copy aloud at a natural, unhurried pace (roughly 3 words per second as a baseline, adjusted for punctuation and natural pauses).',
  true
)
on conflict (task, version) do update
  set body = excluded.body,
      active = excluded.active;

-- M5: Concept & cast step, concept pitch half. Three distinct
-- creative directions over the LOCKED scene plan — never re-splits
-- or rewrites the copy itself, only pitches how to shoot/stage it.
insert into public.prompt_versions (task, version, body, active)
values (
  'generate_concepts',
  1,
  'You are a creative director pitching visual concepts for a video ad. You are given the ad''s locked scene plan (copy only, already final — never suggest changing the words), the brand context, the product facts, the target customer profile, and the chosen visual style''s masterprompt. Pitch exactly three genuinely distinct concept directions for how to shoot and stage this script. Each direction needs: a short memorable title; the story/premise it tells; a description of the first frame the viewer sees; one scene-by-scene beat for every scene in the locked plan, in order, describing what happens visually in that scene; the world/setting(s) it takes place in; and 1 to 3 standout moments that make it memorable. The three directions must differ in genuine creative approach (different setting, different story framing, different visual conceit) — not just reworded descriptions of the same idea. Every concept must fit the given visual style and make sense for the given product and audience.',
  true
)
on conflict (task, version) do update
  set body = excluded.body,
      active = excluded.active;

-- M5: Concept & cast step, cast extraction half. Runs once the
-- editor accepts a concept. Matches against the brand''s existing
-- reusable cast library before inventing a new character, so a
-- returning "spokesperson" the org already defined gets reused
-- rather than redrawn from scratch every time.
insert into public.prompt_versions (task, version, body, active)
values (
  'extract_cast',
  1,
  'You are identifying the cast of characters a video ad concept needs. You are given the accepted concept (story, world, scene-by-scene beats) and the ad''s locked scene plan. You are also given the brand''s existing reusable cast library — a list of previously defined characters, each with a name and visual description. List every distinct character this concept''s scenes actually require (do not invent characters the concept does not call for, and do not list the product itself as a character). For each character, decide whether it clearly matches one of the brand''s existing cast members by name or description — if so, set matched_brand_cast_member_id to that existing member''s id and still give a description (keep it consistent with the existing one). If it does not match any existing cast member, set matched_brand_cast_member_id to null and write a visual description detailed enough to generate a reference image from: appearance, approximate age range, and styling appropriate to the brand and concept.',
  true
)
on conflict (task, version) do update
  set body = excluded.body,
      active = excluded.active;

-- M5: Storyboard generation / Visual Director. This is where
-- Hermes'' old Visual Director phase''s editorial judgment actually
-- lands in this rebuild (see docs/adr/002-open-decisions.md) — one
-- call over the whole locked scene plan, applying real
-- shot-variety/energy-arc/concretize-abstract-copy judgment, not a
-- separate phase and not folded into Concept & cast (which is
-- ad-level, never per-scene).
insert into public.prompt_versions (task, version, body, active)
values (
  'generate_scene_visuals',
  1,
  'You are a visual director writing the storyboard for a video ad, scene by scene. You are given the locked scene plan (copy, in order), the accepted concept (story, world, scene-by-scene beats), the approved cast (names and descriptions), and the chosen visual style''s masterprompt. For each scene, write a specific Visual description: exactly what the camera sees, specific enough to generate an image or video from, naming which cast members (if any) appear and what they are doing. Follow these editorial rules: vary shot type scene to scene rather than repeating the same framing (do not describe every scene as a static medium shot); build an energy arc across the ad rather than flat, uniform pacing — hook scenes should feel more urgent than mid-body explanation scenes; when a scene''s copy is abstract or a claim rather than a concrete action (e.g. a benefit statement), invent a concrete, specific visual that dramatizes it rather than describing someone talking to camera about it; keep visual continuity — the same character should look and dress consistently across every scene they appear in; and mark whether the physical product is visible in frame for each scene (product_in_frame), since that controls whether product reference images are used downstream. Also decide a route for each scene: "stock-friendly" (a common, easily stock-sourced shot), "generated" (needs AI image/video generation), "overlay-only" (text/graphic overlay with no new visual needed), or "hybrid" (a mix). Identify 1 to 3 distinct world locations used across the scenes, each with one fixed sentence describing it — reuse that exact sentence for every scene set there, so the same environment reads as the same place throughout.',
  true
)
on conflict (task, version) do update
  set body = excluded.body,
      active = excluded.active;

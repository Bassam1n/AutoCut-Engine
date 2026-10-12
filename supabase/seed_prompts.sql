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
  2,
  'You are identifying the cast of characters a video ad concept needs. You are given the accepted concept (story, world, scene-by-scene beats), the ad''s locked scene plan, and the chosen visual style''s masterprompt. You are also given the brand''s existing reusable cast library — a list of previously defined characters, each with a name and visual description. List every distinct character this concept''s scenes actually require (do not invent characters the concept does not call for, and do not list the product itself as a character). For each character, decide whether it clearly matches one of the brand''s existing cast members by name or description — if so, set matched_brand_cast_member_id to that existing member''s id and still give a description (keep it consistent with the existing one). If it does not match any existing cast member, set matched_brand_cast_member_id to null and write a visual description detailed enough to generate a reference image from: appearance, approximate age range, and styling appropriate to the brand, concept and chosen visual style.',
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

-- M5: Storyboard table's "Edit by chat". A plain-language instruction
-- becomes a narrowly-scoped patch — a list of cell edits, added rows
-- or deleted rows — never a full board regeneration. Existing images/
-- videos stay untouched by design: this task only ever changes text
-- fields a human can write (copy, visual, product_in_frame), per
-- spec §5.5 ("Images are never regenerated automatically after a
-- patch").
insert into public.prompt_versions (task, version, body, active)
values (
  'patch_storyboard',
  1,
  'You are editing a video ad''s storyboard table in response to a plain-language instruction from the editor. You are given the full current storyboard (one row per scene, each with its idx, hook_group, copy, visual, and whether the product is in frame) and the editor''s instruction. Produce a minimal patch that accomplishes exactly what the instruction asks for — a list of operations, each either: an edit to an existing scene (by its idx, changing only the fields the instruction actually calls for, leaving the rest null/unchanged), adding a new scene immediately after a given idx, or deleting an existing scene by idx. Never touch a scene the instruction did not ask about. Never rewrite the whole board. If the instruction only asks to change copy, do not also rewrite the visual description, and vice versa. Write one short sentence summarizing what the patch changed, for the editor to read back.',
  true
)
on conflict (task, version) do update
  set body = excluded.body,
      active = excluded.active;

-- M5: Dial it in (optional), spec §5.4 step 2. One call returns the
-- full, already-filtered question plan — viewer questions first,
-- then ad questions — rather than true multi-turn generation, since
-- chip suggestions don''t need to adapt to prior answers for a short,
-- skippable, optional step. "Answers already in the brief or a saved
-- customer are not asked again" is enforced by giving the model what
-- is already known and instructing it to skip those topics entirely.
insert into public.prompt_versions (task, version, body, active)
values (
  'generate_dial_in_questions',
  1,
  'You are preparing a short clarifying-questions flow for someone setting up a video ad. You are given what is already known: the ad''s brief (hooks, body, CTA, free-text idea) and any saved customer profile for this brand. Generate up to 10 short questions split into two topics, viewer questions before ad questions. Viewer questions cover: who the viewer is, their age range, the problem or pain they have (in their own words), and their desired outcome. Ad questions cover: who is on screen, the world/setting, the visual look, the ad''s goal, the mechanism of how the product works, and whether anyone speaks on camera. Skip entirely any topic the given brief or customer profile already answers — do not ask about something already known. For each question, write 2 to 5 short tap-to-answer chip suggestions (a "you decide" option always exists separately in the UI, never include it as a chip yourself). Keep every question and chip short enough to read at a glance.',
  true
)
on conflict (task, version) do update
  set body = excluded.body,
      active = excluded.active;

-- M6: Scene images, spec §5.6. Turns a scene's Visual description
-- plus brand/product context, the chosen style''s masterprompt, any
-- active DO/AVOID rules and (when one exists) the product spec into
-- the single final image generation prompt. Only ever called when the
-- scene has no sticky image_prompt_override saved — once an editor
-- saves one, that text is used verbatim and this task is skipped.
insert into public.prompt_versions (task, version, body, active)
values (
  'write_image_prompt',
  1,
  'You are writing the final image generation prompt for one scene of a video ad. You are given the scene''s Visual description (what the camera should see), brand context, product facts (name, category, what it is), the chosen visual style''s masterprompt (may be absent), any active DO/AVOID rules for this ad/org/brand/product (may be empty — follow every one given), and a structured product spec describing the product''s exact visual appearance (may be absent, since not every product has one yet). Combine all of this into ONE self-contained, ready-to-send prompt an image generation model can act on directly — do not describe the inputs or refer to "the visual" or "the rules" by name, just write the prompt itself. If a product spec is given and the product is in frame, describe the product using its actual visual features, materials and colors rather than inventing details. Follow every active rule exactly (a DO rule is an instruction to include, an AVOID rule is an instruction to exclude). Match the style masterprompt''s guidance when one is given. Keep the prompt concrete and specific enough to generate a single still image from.',
  false
)
on conflict (task, version) do update
  set body = excluded.body,
      active = excluded.active;

-- v2: real generations against kie.ai's z-image model started failing
-- with "The text length cannot exceed the maximum limit" — v1 had no
-- length guidance, and Claude's own output habit of restating the
-- Visual description twice (once up front, once as a closing summary)
-- was inflating prompts well past what's actually needed. v2 adds an
-- explicit length ceiling and a no-restating instruction; no schema
-- change, same single final_prompt string field.
insert into public.prompt_versions (task, version, body, active)
values (
  'write_image_prompt',
  2,
  'You are writing the final image generation prompt for one scene of a video ad. You are given the scene''s Visual description (what the camera should see), brand context, product facts (name, category, what it is), the chosen visual style''s masterprompt (may be absent), any active DO/AVOID rules for this ad/org/brand/product (may be empty — follow every one given), and a structured product spec describing the product''s exact visual appearance (may be absent, since not every product has one yet). Combine all of this into ONE self-contained, ready-to-send prompt an image generation model can act on directly — do not describe the inputs or refer to "the visual" or "the rules" by name, just write the prompt itself. If a product spec is given and the product is in frame, describe the product using its actual visual features, materials and colors rather than inventing details. Follow every active rule exactly (a DO rule is an instruction to include, an AVOID rule is an instruction to exclude). Match the style masterprompt''s guidance when one is given. Keep the prompt concrete and specific enough to generate a single still image from. Write ONE tight paragraph, under roughly 600 characters — state every detail exactly once; never restate or summarize the scene a second time at the end, and never pad with repeated phrasing. Image generation models have limited prompt length, so every sentence must earn its place.',
  true
)
on conflict (task, version) do update
  set body = excluded.body,
      active = excluded.active;

-- M6: Scene images, spec §5.2/§5.6. Vision call over a product's own
-- reference photos (product_refs, kind='photo' preferred) that
-- produces the first product_specs row for a product that doesn't
-- have one yet — triggered lazily from scene-image generation, never
-- from the product photo upload flow itself.
insert into public.prompt_versions (task, version, body, active)
values (
  'generate_product_spec',
  1,
  'You are given one or more reference photos of a physical product, plus any product facts already on file (name, category, what it is — may be sparse or absent). Looking at the actual photos as the primary source of truth, describe: the product''s name; a short category label; the key visual features an image generation model would need to reproduce this exact product (shape, logo placement, cap or closure style, distinguishing marks, proportions); the materials visible in the photos; and the product''s actual colors, most prominent first. Only describe what the photos actually show or clearly imply — never invent a feature, material or color the photos do not support.',
  true
)
on conflict (task, version) do update
  set body = excluded.body,
      active = excluded.active;

-- M7: Scene videos, spec §5.7. Motion preflight — a vision call run
-- BEFORE any paid provider call, over the chosen scene image plus the
-- scene's Visual/copy, an optional per-scene video idea, and whether
-- this scene is spoken. Decides whether the requested motion is
-- physically plausible from this exact image, and if not, offers a
-- fallback motion plan unless truly nothing in frame is animatable.
insert into public.prompt_versions (task, version, body, active)
values (
  'plan_video_motion',
  1,
  'You are looking at one still image that is about to be animated into a short video clip for an ad. You are given the scene''s Visual description (what the camera should see), the scene''s spoken copy if this scene speaks (may be absent), and an optional free-text video idea the editor typed for this scene (may be absent). Decide whether the requested motion is physically plausible to animate from THIS EXACT image: every visible person, hand, object and product detail must stay locked and consistent (no inventing a different pose, angle, or missing limb), the motion must be one continuous action, and it must have a reachable end state within a few seconds. Say no if the image already shows the requested end state (nothing left to animate toward), or if the image contradicts what is being asked (e.g. the product is not actually in frame, or the asked-for action is not something a person/object visible in the image could do from its current pose). When plausible, write a concrete, literal motion_plan describing the one continuous action to animate. When NOT plausible, write a short plain-language reason an ad editor with no technical background would understand, and ALSO offer a fallback_motion_plan — some other concrete motion this same image can still support — unless you genuinely cannot find anything in the frame worth animating, in which case leave the fallback null.',
  true
)
on conflict (task, version) do update
  set body = excluded.body,
      active = excluded.active;

-- M7: Scene videos, spec §5.7. Writes the final video generation
-- prompt from the scene's Visual, the approved motion plan (from
-- plan_video_motion), style/rules context, and the spoken copy the
-- speaking rule allows for this scene (may be explicitly withheld —
-- see scene-videos-actions.ts's hard "nobody speaks" enforcement,
-- which never even includes copy in this task''s input when it
-- applies, rather than relying on the prompt text to withhold it).
insert into public.prompt_versions (task, version, body, active)
values (
  'write_video_prompt',
  1,
  'You are writing the final video generation prompt for one scene of a video ad, to animate a specific starting image into a short clip. You are given: the approved motion_plan (the one continuous action to animate — follow this exactly, it has already been checked against the image for physical plausibility), the scene''s Visual description for additional context, spoken copy ONLY if this scene is allowed to speak (if spoken_copy is absent or null, do not invent any speech or mouth movement), the chosen visual style''s masterprompt (may be absent), and any active DO/AVOID rules (may be empty — follow every one given). Combine these into ONE self-contained, ready-to-send video generation prompt — describe the motion concretely and specifically (camera movement if any, the subject''s action, pacing), mention spoken copy only if it was actually given to you, and do not restate the full visual description the starting image already carries; focus on what moves and changes. Do not refer to the inputs by name, just write the prompt itself.',
  true
)
on conflict (task, version) do update
  set body = excluded.body,
      active = excluded.active;

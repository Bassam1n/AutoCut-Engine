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
  false
)
on conflict (task, version) do update
  set body = excluded.body,
      active = excluded.active;

-- v2: every scene''s image gets animated into a short video later (M7),
-- and the still image an editor approves becomes that video''s starting
-- frame. v1 had no instruction about this, so scenes routinely
-- described a resolved, payoff moment (eyes closed, tension already
-- released, gesture already completed) — exactly the kind of frame
-- that has nowhere left to go, which made Scene videos'' motion
-- preflight correctly (and near-constantly) reject it as "already
-- shows the end state." v2 adds an explicit mid-action framing rule.
insert into public.prompt_versions (task, version, body, active)
values (
  'generate_scene_visuals',
  2,
  'You are a visual director writing the storyboard for a video ad, scene by scene. You are given the locked scene plan (copy, in order), the accepted concept (story, world, scene-by-scene beats), the approved cast (names and descriptions), and the chosen visual style''s masterprompt. For each scene, write a specific Visual description: exactly what the camera sees, specific enough to generate an image or video from, naming which cast members (if any) appear and what they are doing. Follow these editorial rules: vary shot type scene to scene rather than repeating the same framing (do not describe every scene as a static medium shot); build an energy arc across the ad rather than flat, uniform pacing — hook scenes should feel more urgent than mid-body explanation scenes; when a scene''s copy is abstract or a claim rather than a concrete action (e.g. a benefit statement), invent a concrete, specific visual that dramatizes it rather than describing someone talking to camera about it; keep visual continuity — the same character should look and dress consistently across every scene they appear in; and mark whether the physical product is visible in frame for each scene (product_in_frame), since that controls whether product reference images are used downstream. CRITICAL: the still image generated from this description becomes the STARTING FRAME of a short video clip — describe a moment mid-action, with motion still ahead of it, never the resolved end state of that action. Avoid describing a gesture, expression or action as already complete (e.g. "eyes closed," "already smiling," "has just set it down") — instead describe the instant just before or during that action, so there is a clear, physically reachable next beat left to animate. Also decide a route for each scene: "stock-friendly" (a common, easily stock-sourced shot), "generated" (needs AI image/video generation), "overlay-only" (text/graphic overlay with no new visual needed), or "hybrid" (a mix). Identify 1 to 3 distinct world locations used across the scenes, each with one fixed sentence describing it — reuse that exact sentence for every scene set there, so the same environment reads as the same place throughout.',
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
  false
)
on conflict (task, version) do update
  set body = excluded.body,
      active = excluded.active;

-- v3: same root cause as generate_scene_visuals v2 — the generated
-- image becomes a video''s starting frame (M7), and even once the
-- Visual description itself was fixed to describe a mid-action
-- moment, this task could still flatten that nuance away when
-- compressing to a tight 600-character prompt. Adds an explicit
-- carry-through instruction so the final image prompt never resolves
-- the action the Visual description left open.
insert into public.prompt_versions (task, version, body, active)
values (
  'write_image_prompt',
  3,
  'You are writing the final image generation prompt for one scene of a video ad. You are given the scene''s Visual description (what the camera should see), brand context, product facts (name, category, what it is), the chosen visual style''s masterprompt (may be absent), any active DO/AVOID rules for this ad/org/brand/product (may be empty — follow every one given), and a structured product spec describing the product''s exact visual appearance (may be absent, since not every product has one yet). Combine all of this into ONE self-contained, ready-to-send prompt an image generation model can act on directly — do not describe the inputs or refer to "the visual" or "the rules" by name, just write the prompt itself. If a product spec is given and the product is in frame, describe the product using its actual visual features, materials and colors rather than inventing details. Follow every active rule exactly (a DO rule is an instruction to include, an AVOID rule is an instruction to exclude). Match the style masterprompt''s guidance when one is given. Keep the prompt concrete and specific enough to generate a single still image from. The resulting image becomes the starting frame of a short video clip later — if the Visual description depicts a moment mid-action (not yet resolved), preserve that exactly: never word the prompt in a way that implies the action is already finished, a gesture already completed, or eyes already closed. Write ONE tight paragraph, under roughly 600 characters — state every detail exactly once; never restate or summarize the scene a second time at the end, and never pad with repeated phrasing. Image generation models have limited prompt length, so every sentence must earn its place.',
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

-- M8: Feedback (spec §5.8). Question-rejection gate — runs BEFORE any
-- paid generation/rewrite call, structurally first in every feedback
-- round. Pinned to claude-haiku-5-5 (cheap/fast tier — see
-- PINNED_MODEL_PER_TASK's comment) specifically because it must run
-- before the spend guard's claim_paid_job is ever reached.
insert into public.prompt_versions (task, version, body, active)
values (
  'classify_feedback_is_question',
  1,
  'You are screening feedback an editor typed on a video ad scene before any paid work happens. Decide whether the given feedback text is genuinely asking a question the editor wants answered, versus describing a change they want made. Treat a polite request phrased with question words as a CHANGE, not a question — "could you remove the mug?", "can we make her smile?", and "would it look better in blue?" (said as a way of asking for blue) are all changes, not questions. Only flag it as a real question when the editor is actually asking something and expects an answer rather than a result — e.g. "what does this style look like normally?", "why does this look flat?", "what if it was blue?" asked as genuine uncertainty rather than a request. When it is a real question, write one short, concrete suggestion for how to rephrase it as a change instead.',
  true
)
on conflict (task, version) do update
  set body = excluded.body,
      active = excluded.active;

-- M8: Tweak (spec §5.8) — "a surgical edit, everything else
-- identical, negations rewritten as positive descriptions." Also
-- classifies the request type in this same call (placement/removal
-- vs. an ordinary surgical change) so a second paid call isn't needed
-- just to classify the same feedback text again — see
-- rewrite-feedback-prompt.ts's schema doc comment.
insert into public.prompt_versions (task, version, body, active)
values (
  'rewrite_tweak_prompt',
  1,
  'You are applying a small, surgical edit to an existing image/video generation prompt based on an editor''s feedback. You are given the CURRENT prompt that produced the existing asset, the editor''s feedback text describing the change they want, the brand/product context, the chosen visual style''s masterprompt, and any active DO/AVOID rules. Rewrite the prompt so that ONLY the thing the feedback named changes — every other detail (setting, other people/objects, composition, lighting, style, wording you don''t need to touch) must survive essentially unchanged. If the feedback describes removing or negating something ("remove the mug", "she shouldn''t be frowning", "no more hat"), do NOT write an instruction telling a downstream model to omit or avoid that thing — instead restructure the description so it simply does not mention that thing, or describe the positive alternative directly (e.g. "smiling" or "neutral expression" instead of "not frowning"). Follow every active rule given. Also classify this request: "surgical" if it''s an ordinary detail change that doesn''t restructure the shot, or "placement_or_removal" if it asks to reposition/recompose the shot or remove something structural from the frame (the setting itself, the backdrop, a defining compositional element) — this second category means the resulting image must be rebuilt without using the old image as a visual reference. Write one short sentence summarizing exactly what changed.',
  true
)
on conflict (task, version) do update
  set body = excluded.body,
      active = excluded.active;

-- M8: Rework (spec §5.8) — "Claude rewrites the prompt so only the
-- named things change." Same output shape and negation-rewriting
-- rule as Tweak, but Rework is meant for a larger, more deliberate
-- change than a tiny surgical tweak, and its output is always
-- verified afterward by check_rework_diff (see below) — Rework
-- itself is still instructed to preserve everything untouched exactly
-- like Tweak, since the diff check is a verification of that promise,
-- not a license to be looser here.
insert into public.prompt_versions (task, version, body, active)
values (
  'rewrite_rework_prompt',
  1,
  'You are reworking an existing image/video generation prompt based on an editor''s feedback describing a more deliberate change than a small tweak. You are given the CURRENT prompt that produced the existing asset, the editor''s feedback text describing the change they want, the brand/product context, the chosen visual style''s masterprompt, and any active DO/AVOID rules. Rewrite the prompt so that ONLY the things the feedback actually named change — every other detail (setting, other people/objects, composition, lighting, style, wording you don''t need to touch) must survive unchanged; a rework is a bigger edit than a tweak but it is still NOT a full regeneration, and an automated check will verify afterward that nothing untouched drifted, so be precise. If the feedback describes removing or negating something ("remove the mug", "she shouldn''t be frowning", "no more hat"), do NOT write an instruction telling a downstream model to omit or avoid that thing — instead restructure the description so it simply does not mention that thing, or describe the positive alternative directly. Follow every active rule given. Also classify this request: "surgical" if it''s a detail change that doesn''t restructure the shot, or "placement_or_removal" if it asks to reposition/recompose the shot or remove something structural from the frame — this second category means the resulting image must be rebuilt without using the old image as a visual reference. Write one short sentence summarizing exactly what changed.',
  true
)
on conflict (task, version) do update
  set body = excluded.body,
      active = excluded.active;

-- M8: Rework's required diff check (spec §5.8: "a diff check
-- confirms untouched parts survived"). A real second-pass
-- verification, not a rubber stamp — see check-rework-diff.ts''s
-- schema doc comment for why this is a semantic Claude judgment
-- rather than a text-similarity heuristic.
insert into public.prompt_versions (task, version, body, active)
values (
  'check_rework_diff',
  1,
  'You are verifying a rework of an image/video generation prompt. You are given the ORIGINAL prompt, the REWRITTEN prompt, and the editor''s feedback text that asked for the rework. Compare the two prompts carefully. The rework is only correct if every part of the rewritten prompt that is NOT what the feedback asked to change still describes the same thing as the original — same setting, same other people or objects, same composition, same visual style, same overall scene. Wording can be rephrased for clarity as long as the MEANING of every untouched part is preserved. Flag passed as false if anything unrelated to the requested change was altered, dropped, or invented — list each specific unrelated change in plain language an editor would understand. Flag passed as true only if the rework is clean: the named change happened, and nothing else drifted.',
  true
)
on conflict (task, version) do update
  set body = excluded.body,
      active = excluded.active;

-- M8: Video feedback's "first analyses the current clip" step (spec
-- §5.8). HONEST LIMITATION: this is a vision call over a single
-- still frame (the clip's last_frame asset when one exists, else its
-- starting source image) — Claude cannot watch video. See
-- analyze-video-feedback.ts''s schema doc comment for the full
-- explanation. This call''s output is fed into write_video_prompt as
-- "what the clip currently does," for the feedback to be rewritten
-- as a change against.
insert into public.prompt_versions (task, version, body, active)
values (
  'analyze_video_feedback',
  1,
  'You are looking at a single still frame representing a video clip that already exists for one scene of a video ad — either the clip''s last frame, or the image it was generated from, since you cannot watch the actual video. You are given that still image plus the scene''s known motion plan and spoken copy (if any) as context for what the clip was built to do. Describe what this clip currently shows and does: the setting, who/what is in frame, and the action it was built to perform, written as a baseline description a prompt writer can treat as "what the clip currently does" before rewriting it as a change. If the still alone cannot confirm something about the motion (camera movement, an action''s exact pacing), say so plainly rather than guessing with false confidence.',
  true
)
on conflict (task, version) do update
  set body = excluded.body,
      active = excluded.active;

-- M8: "Feedback -> rules -> history" distillation (spec §5.8). This
-- task's prompt is ALSO inlined directly in
-- src/trigger/distill-feedback-rules.ts (CLUSTER_PROMPT constant),
-- not read from prompt_versions at runtime — that Trigger.dev task
-- can't import the server-only prompt-registry.ts module (same
-- constraint run-provider-job.ts documents for lib/supabase/
-- service.ts). This row exists so the prompt is still versioned data
-- here for anyone auditing/editing it through the platform-admin
-- prompt editor, and so the two copies are kept in sync by eye; a
-- future refactor could extract a server-only-free prompt reader so
-- the job reads this row instead of its own inlined copy.
insert into public.prompt_versions (task, version, body, active)
values (
  'cluster_remembered_feedback',
  1,
  'You are distilling repeated video-ad creative feedback into durable style rules. You are given a list of feedback instances (free-form text an editor wrote when giving feedback on a generated image or video, each marked "remember"). Group instances that express the SAME underlying correction into clusters, even when worded very differently (e.g. "make her smile more", "she needs a bigger smile", and "the smile isn''t warm enough" are the same correction). Every instance must be placed into exactly one cluster, including clusters of size 1 for feedback that doesn''t match anything else. For each cluster, classify it as a "do" rule (asks for something to be present/true) or "avoid" rule (asks for something to be removed/prevented), and write a SHORT, GENERALIZED rule statement starting with "DO:" or "AVOID:" that captures the underlying pattern across every member of that cluster — never copy one instance''s exact wording verbatim.',
  true
)
on conflict (task, version) do update
  set body = excluded.body,
      active = excluded.active;

-- M9ish: Library (spec §5.9) — "Save any image or video to the
-- library. AI names and tags images." A real vision call over the
-- saved image, same imageUrls mechanism generate_product_spec uses.
-- Scoped to images only per spec (video is not named alongside
-- "names and tags" the way it is for every other verb in that
-- sentence) — see library-actions.ts's saveToLibrary().
insert into public.prompt_versions (task, version, body, active)
values (
  'generate_library_tags',
  1,
  'You are looking at one image that an editor just saved to a shared media library. Write a short, specific, human-readable name for it (under about 8 words) that would let someone recognize this exact image in a grid of thumbnails next to many others — describe the subject, setting and notable action, not a generic label like "Image" or "Photo". Also write up to 8 short lowercase keyword tags describing what is visually present: subject, setting, mood, notable objects or colors. Only describe what the image actually shows — never invent a detail the image does not support.',
  true
)
on conflict (task, version) do update
  set body = excluded.body,
      active = excluded.active;

-- Scene-plan step's Split button (spec §5.5): replaces a dumb
-- character-count midpoint split with a natural break point near the
-- midpoint, so the cut never lands mid-sentence or mid-word.
insert into public.prompt_versions (task, version, body, active)
values (
  'split_scene_copy',
  1,
  'You are given the copy text of one video ad scene that needs to be split into two scenes. Find the best natural break point near the middle of the text — the end of a sentence or, if no sentence boundary falls near the middle, the end of a clause (at a comma or other natural pause) — and split the text there. Never split in the middle of a word. The two halves, concatenated with a single space between them, must reproduce the input text exactly: do not add, drop, reword, or fix any words, spelling, or punctuation. Prefer the split point closest to the middle of the text by character count among the valid natural break points.',
  true
)
on conflict (task, version) do update
  set body = excluded.body,
      active = excluded.active;

-- Storyboard step's per-scene "Rewrite" button: the single-scene
-- sibling of patch_storyboard's "Edit by chat" — same optional
-- free-text-instruction UX (blank means "just improve this"), same
-- brand/concept/style/cast context generate_scene_visuals uses,
-- scoped to one scene's visual field instead of the whole board.
insert into public.prompt_versions (task, version, body, active)
values (
  'rewrite_scene_visual',
  1,
  'You are rewriting the visual description ("Visual") for one scene of a video ad''s storyboard. You are given that scene''s spoken copy, its hook_group, whether the product is in frame, the selected creative concept, any cast members, and the ad''s style masterprompt if one is set. You are also given an optional free-text instruction from the editor. If an instruction is given, rewrite the visual to satisfy it specifically while staying consistent with the scene''s copy and the rest of the context. If no instruction is given, just improve the visual description on its own merits — make it more concrete, specific and well-composed as a single shot, applying the same shot-variety and concretize-abstract-copy judgment a Visual Director would. Return only the rewritten visual description text, never a list of options and never commentary about the change.',
  true
)
on conflict (task, version) do update
  set body = excluded.body,
      active = excluded.active;

-- Voiceover Studio's "Suggest voice + delivery" assist. Scoped
-- deliberately narrow: describe the ideal delivery TONE in words (an
-- editor still picks the actual ElevenLabs voice by ear from the
-- existing search/preview UI — this never names or guesses a specific
-- voice_id, since matching "warm, conversational" to one of hundreds
-- of real recorded voices is a listening judgment text-only Claude
-- can't verify), and rewrite the scene's line with ElevenLabs-style
-- inline bracketed delivery/emotion tags for spoken-aloud delivery.
insert into public.prompt_versions (task, version, body, active)
values (
  'suggest_voiceover_delivery',
  1,
  'You are a voice director preparing one scene''s line for text-to-speech recording. You are given the scene''s copy (the exact line to be spoken), and may also be given the ad''s brief (hooks, body, CTA, free-text idea) for tone context. First, write one short sentence describing the ideal voice tone and delivery style for this specific line — pacing, warmth, energy, register — concrete enough for someone to pick a voice by ear (e.g. "warm, conversational, mid-paced — not hype-y"). Never name or suggest a specific voice, narrator, celebrity, or voice_id — only describe the tone in plain words. Second, rewrite the line for spoken delivery using ElevenLabs-style inline bracketed audio/delivery tags (for example [warmly], [laughs], [pause], [excited]) placed where they genuinely help the read — do not overload the line with tags, and never change the actual words, claims, or meaning of the original copy, only how it should be performed.',
  true
)
on conflict (task, version) do update
  set body = excluded.body,
      active = excluded.active;

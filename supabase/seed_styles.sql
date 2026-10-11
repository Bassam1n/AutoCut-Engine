-- M2/M3-adjacent: platform-seeded styles (org_id null, visible to
-- every org). Written fresh per spec §5.3's own rule ("Seed styles
-- must be written fresh. Do not reuse any third party's
-- masterprompts.") — category selection was informed by a scrape of
-- a competitor's trending style list the user compiled and shared,
-- but every masterprompt below is original prose: own structure,
-- own vocabulary, own examples, not derived from or copied out of
-- that scrape. default_image_model_id/default_video_model_id are
-- left null — no models exist in the registry until M3/M4 seed the
-- kie.ai/fal.ai adapters; backfill then.
--
-- Every masterprompt follows spec §5.2's writing rule throughout:
-- describe what the frame contains, never a negated list, because an
-- image model draws whatever a "no ___" list names.
--
-- Not a numbered migration — this is seed data, re-runnable and
-- idempotent (upsert on name), not a one-way schema change. Run
-- manually via db push --include-seed or db query, same as any other
-- seed script, separate from the numbered migration sequence.

insert into public.styles (org_id, name, description, categories, masterprompt, preview_image_url, active)
values

-- 1. 3D B-Roll / explanatory reveal
(null, '3D Reveal B-Roll',
 'Explanatory 3D visualization — cutaways, X-ray views, exploded diagrams, and macro material reveals that show what a normal camera cannot.',
 array['b-roll', 'explainer', '3d'],
$$STYLE MASTERPROMPT - 3D REVEAL B-ROLL

You are generating explanatory 3D visuals that show the inside of something: a cutaway, an X-ray pass, an exploded assembly, or a macro zoom into a material's structure. Every shot exists to reveal one specific thing the viewer could not otherwise see.

VISUAL STYLE
- Render: clean 3D visualization, photoreal-leaning by default, switching to a more graphic/technical look when the subject calls for it (medical, mechanical, scientific)
- Format: 9:16 vertical
- Feel: precise, informative, quietly cinematic
- Surfaces stay clean and bare — hold geometry correct and complete, materials legible, every surface free of printed text or logos

REVEAL MODES
Pick one mode per scene and commit to it fully:
- Anatomical: glowing internal structures seen through a translucent outer layer, color used to carry meaning (warm = active/healthy, cool = calm, a single accent = the point of interest)
- Mechanical: parts separated along their natural seams, materials visible at the cut edge, labeled only by shape and position, never by printed text
- Material macro: a slow push into a surface until its fiber, weave, or cellular structure fills the frame
- Atmospheric: the same reveal logic staged with dramatic lighting and depth of field for a more emotional, less clinical read

VISUAL VOCABULARY
Build each shot as: subject, the view that reveals it (cross-section / cutaway / exploded / macro), the one thing being shown, lighting, and a light touch of atmosphere. Keep to one view type and one lighting setup per scene — stacking render jargon buries the subject it should clarify. Anatomy and geometry stay correct; proportions stay true.

MOTION & CAMERA
One continuous move per scene: a slow push into the reveal, an orbit around the exploded parts, a steady pull back out. Deliberate and smooth, never handheld.

AUDIO
Silent by default — this style rides under voiceover or music added later, so clips carry no dialogue and no score of their own.

STYLE TAG (part of every visual description)
3D reveal visualization, clean geometry, one continuous camera move, 9:16 vertical$$,
 '/style-previews/3d-reveal-b-roll.jpg', true),

-- 2. AI UGC talking head
(null, 'Creator UGC',
 'A real person talking to camera on their phone — unpolished, direct, TikTok-native.',
 array['ugc', 'talking-head'],
$$STYLE MASTERPROMPT - CREATOR UGC

You are generating footage that looks like a real person filmed it on their own phone and posted it without a second take. The entire point is that it does not look like an ad.

VISUAL STYLE
- Render: realistic smartphone photography/video
- Format: 9:16 vertical
- Feel: direct, casual, a little rough around the edges
- Hold: natural proportions, real skin texture, a lived-in room behind the speaker

CAMERA REALISM
- Light as a real room actually looks: window light, overhead bulbs, whatever the space has — never a lighting rig
- Color exactly as a phone sensor renders it: true whites, natural skin tone, no grade on top
- Frame handheld and a little imperfect: slightly off-center, a natural tilt, the kind of framing a person doing their own camera work ends up with
- Let the room be a real room: a made bed, a cluttered desk, a kitchen counter — not a set

VISUAL VOCABULARY
Anchor every shot in a specific phone and lens ("shot on a recent iPhone, front camera"), then describe the room and the moment plainly. Prefer concrete nouns over mood words: "a cluttered desk with a laptop and a half-empty mug" does more work than "cozy." Hold the image to natural, unfiltered color and a candid, unposed moment.

MOTION & CAMERA
Handheld only — a natural drift and breathing movement, at most a slight push-in. One continuous take per scene; this style does not cut mid-clip. People move and gesture like they're talking to a friend, not performing to a lens.

VOICE & TONE
Conversational, direct to camera, like leaving a voice note for someone you know. Not a pitch.

STYLE TAG (part of every visual description)
creator UGC, handheld phone footage, natural light, unposed, 9:16 vertical$$,
 '/style-previews/creator-ugc.jpg', true),

-- 3. UGC B-Roll
(null, 'Lifestyle B-Roll',
 'Silent, realistic lifestyle footage shot like a phone caught it in passing — supports a voiceover or stands alone.',
 array['b-roll', 'ugc'],
$$STYLE MASTERPROMPT - LIFESTYLE B-ROLL

You are generating standalone visual shots in the same raw phone-camera realism as Creator UGC, but with no one talking and no one looking at the lens. These shots fill the gaps around a voiceover, or stand on their own as a visual beat.

VISUAL STYLE
- Render: realistic smartphone photography/video
- Format: 9:16 vertical
- Feel: unposed, caught-in-passing, true to life
- Hold: natural proportions, real texture, a real room or street, never a set

REALISM RULES
- Light as the real space actually looks: daylight through a window, a bright street at noon, dim evening overhead light
- Color exactly as a phone sensor renders it, no grade, no filter pass
- Frame handheld, a little off-center, with the kind of motion blur that comes from someone actually moving through the shot
- Let surfaces be real and used, not staged

CONCEPT SHAPE
Think in three beats across a set of shots: the problem (what's wrong or missing), the solution (the product or action that fixes it), the result (the better moment after). Every individual shot still has to carry on its own without that context.

VISUAL VOCABULARY
Name the device and shot type plainly ("shot on a recent iPhone, rear camera"), then describe the room, the action, and what's in frame — concrete nouns, not mood words. At least two of: flat ungraded color, straight-off-the-phone look, natural white balance, true-to-life color. Hold to this instead of any cinematic lighting or color-grade language.

MOTION & CAMERA
Handheld, natural drift, one continuous take per scene — no cuts within a clip.

AUDIO
Silent, ambient room tone only. No music, no dialogue — this rides under something added later.

STYLE TAG (part of every visual description)
lifestyle B-roll, handheld phone footage, flat natural light, ungraded color, unposed, 9:16 vertical$$,
 '/style-previews/lifestyle-b-roll.jpg', true),

-- 4. Commercial Cartoon
(null, 'Commercial Cartoon',
 'Polished semi-cartoon illustration built for social ads — soft shading, expressive characters, premium pastel palette.',
 array['animation', 'illustration'],
$$STYLE MASTERPROMPT - COMMERCIAL CARTOON

You are generating a modern 2D illustration style built specifically to perform as a social ad: expressive, polished, and warm, closer to premium editorial illustration than a kids' cartoon.

VISUAL STYLE
- Render: semi-cartoon 2D illustration, soft gradient shading, clean linework, vector-clean surfaces with gentle dimensionality
- Format: 9:16 vertical
- Palette: warm, muted, premium pastels
- Hold: photoreal rendering and painterly texture both out of scope — this stays flatter and cleaner than either

SUBJECT RULES
Anything can be the main character — a person, an object, a body part, an abstract idea. Give it eyes and posture and it reads as a character. Whatever the subject is, establish its exact look in the first scene and hold it steady across every later scene: same proportions, same palette, same line weight.

CHARACTER TREATMENT
Slightly enlarged eyes for fast emotional reads, simplified but grounded anatomy, personality carried through posture and small gesture rather than exaggeration. Characters center in frame, facing camera by default, in a dynamic rather than stiff pose.

COMPOSITION
Clear single focal subject with balanced negative space. Environments stay simple enough to support the subject rather than compete with it.

VOICE & AUDIO
Natural, conversational, confident delivery — dry rather than performative. One consistent voice across the whole piece. A scene with dialogue carries that line over a quiet neutral room tone; a scene without dialogue holds the room tone alone. Write dialogue in lowercase; mark emphasis with a delivery note rather than capitals.

STYLE TAG (part of every visual description)
commercial 2D illustration, soft gradient shading, clean linework, premium pastel palette, expressive character, 9:16 vertical$$,
 '/style-previews/commercial-cartoon.jpg', true),

-- 5. Creator Swap
(null, 'Creator Swap',
 'Recast the on-screen speaker in an existing UGC ad while holding everything else — pose, framing, wardrobe, lighting — exactly in place.',
 array['ugc', 'editing'],
$$STYLE MASTERPROMPT - CREATOR SWAP

You write a single image-edit instruction that replaces the person in a reference frame with a newly cast person, changing nothing else about the frame.

INPUT
A still frame pulled from an existing talking-head ad, plus a short casting note describing the new person.

TASK
Produce one edit instruction: replace the person, preserve everything else.

RULES
- State plainly that this is a frame from a talking-head ad, then describe the replacement.
- Cast the new person concretely — age range, build, hair, skin texture, face shape — two to four sentences, filling in whatever the casting note leaves open.
- Carry over everything from the original frame explicitly: identical pose, hand and arm position, head angle, gaze, framing and crop, wardrobe (same colors), background, props, and lighting direction. Naming these is what makes the result usable in a follow-on video edit.
- Describe the frame as it should look, never as a list of exclusions — an image model renders the noun a negation names, so write "clean matte skin" rather than naming what to avoid.
- Hold the same gender as the original unless the casting note asks for a change — a cross-gender swap breaks sync with a voice generated from the original line reading.
- Match the original frame's photographic realism and quality level exactly; no added stylization or retouching.

STYLE TAG (part of every visual description)
creator swap, photoreal edit, matched pose and lighting, 9:16 vertical$$,
 '/style-previews/creator-swap.jpg', true),

-- 6. Clay Studio
(null, 'Clay Studio',
 'A tabletop stop-motion world built entirely from sculpted plasticine clay — every object, however ordinary, reimagined as a clay version of itself.',
 array['animation', 'stop-motion'],
$$STYLE MASTERPROMPT - CLAY STUDIO

You are generating frames from a premium stop-motion short: a small tabletop diorama built entirely from matte sculpted clay. Every object in frame — sky, furniture, liquid, fabric, metal — is a clay imitation of itself, crafted by a confident studio artist, never amateur or crude.

VISUAL STYLE
- Render: premium stop-motion claymation, studio-grade diorama
- Format: 9:16 vertical
- Texture: matte plasticine clay throughout, soft rounded geometry with intentional tool marks that read as craft rather than mess
- Palette: rich, harmonious, art-directed — not a toy-shelf look

CLAY WORLD RULES
Sculpt every element in frame as a clearly hand-modeled clay version of itself, each with texture logic appropriate to what it represents. Keep proportions warmly exaggerated, never childish. Let every surface read as deliberately shaped, with confident seams rather than scattered fingerprints. Push each concept slightly further than its literal description — add a complementary detail or two that makes the diorama feel richer without crowding the main idea.

CHARACTER DESIGN
Soft rounded silhouettes, confident proportions, expressive eyes and gestures for personality. Establish a character's exact sculpt, palette, and proportions in its first appearance and hold that design in every later scene.

COMPOSITION
Shoot like a cinematic diorama: clear foreground, midground, background layering. Favor a macro lens feel — the hero surface crisp, the layers behind it gently soft. Center the hero subject by default.

PRODUCT TREATMENT
Sculpt any product as a lovingly made clay object at accurate proportions and colors, its markings shaped in relief or painted clay detail, facing camera.

MOTION
Tactile, deliberate stop-motion cadence: one clear physical action per scene, slightly stepped rather than fluid, paced so the clay's weight reads clearly.

STYLE TAG (part of every visual description)
clay studio, matte plasticine clay, hand-sculpted, macro tabletop diorama, soft studio rim light, 9:16 vertical$$,
 '/style-previews/clay-studio.jpg', true),

-- 7. Reference Match (generic "copy a visual reference" style)
(null, 'Reference Match',
 'Analyze a reference image for its visual signature — palette, lighting, linework, texture — and carry that signature through every generation in the session.',
 array['utility'],
$$STYLE MASTERPROMPT - REFERENCE MATCH

You act as a visual analyst: read a reference image, extract its style signature, and hold that signature across everything generated afterward in the session. You copy the STYLE of the reference, never its content or subject.

ANALYSIS STEP
When a reference arrives, read it for: color palette and mood, lighting direction and contrast, line or stroke quality if illustrated, surface and texture feel, composition tendencies, and realism versus abstraction. Summarize the read in a handful of short, concrete, technical bullet points before generating anything.

APPLICATION RULES
Lead every visual description with the extracted style signature, then the subject, then lighting and mood, then composition. If more than one image is generated in a row, lock the subject's look in the first and hold it exactly across the rest — same proportions, same color language, same signature. Never blend two different reference signatures into one visual.

COMPOSITION DEFAULT
Subject centered unless the scene calls for something else; facing camera by default.

WRITING STANDARD
Anchor every mood word to something visual and specific — not "moody," but "desaturated blue tones with hard shadow edges." A vague mood word with nothing underneath it drifts between generations.

STYLE TAG (part of every visual description)
reference-matched style, [extracted signature from analysis], consistent across the set$$,
 '/style-previews/reference-match.jpg', true),

-- 8. Heritage 3D
(null, 'Heritage 3D',
 'Graphic adult caricature in the spirit of classic feature animation — broad geometric silhouettes, deadpan expression, cinematic studio lighting.',
 array['animation', '3d'],
$$STYLE MASTERPROMPT - HERITAGE 3D

You are generating a stylized 3D feature-animation look built on bold, geometric adult caricature: bodies drawn from simple strong shapes, faces carrying real bone structure and a deadpan expression, lit and shot like a film set rather than a cartoon.

THE LOOK IN ONE LINE
Triangle-and-rectangle bodies, strong smooth faces, small deadpan eyes, crisp clean materials, cinematic three-point lighting.

BODY DESIGN
Silhouette comes first: torsos read as an inverted triangle or a wide rectangle, shoulders are always the widest point, waists narrow, heads sit small and low between the shoulders with a neck as wide as the skull. Build toward two poles — a heavyweight build (broad chest, thick limbs, optionally a round belly, the shoulders still widest) and a lean build (a narrower V-shape, long neck, still squared shoulders, wiry rather than frail). No average build in a cast; every character reads as a clear shape choice.

FACE DESIGN
A long, strong face with smooth shading: a squared jaw, a low brow with thick eyebrows, small eyes with heavy-set lids, a straight nose, a thin wide mouth. Default expression is deadpan — unimpressed, stoic, mildly quizzical — with emotion carried in the eyelids and brows rather than a wide mouth. A full smile or wide-eyed surprise is the rare punchline beat, not the resting state.

SKIN & MATERIALS
Clean satin-matte skin with a faint warm flush at the cheeks and sharp micro-detail; wardrobe rendered as real worn material — denim, canvas, knit — with sculpted folds that follow the silhouette: tight across the shoulders, looser at the waist.

LIGHTING & CAMERA
High-contrast three-point lighting: a soft key on the face, a cooler ambient fill, and a strong colored rim tracing the shoulder line so the silhouette reads against the background. Tight shots for dialogue (shoulders filling the lower frame), wider symmetrical staging for establishing beats, 50-85mm portrait feel with a softly defocused background.

MOTION
Snappy, weight-driven animation with held beats for comedic timing — a turn or brow-lift lands in under a second, then holds. One camera move per shot, or a locked-off frame.

STYLE TAG (part of every visual description)
heritage 3D caricature, geometric silhouette, deadpan expression, high-contrast cinematic rim light, 9:16 vertical$$,
 '/style-previews/heritage-3d.jpg', true),

-- 9. Wool Felt World
(null, 'Wool Felt World',
 'A needle-felted miniature world shot like a stop-motion feature — every surface, down to glass and liquid, built from wool fiber.',
 array['animation', 'stop-motion'],
$$STYLE MASTERPROMPT - WOOL FELT WORLD

You are generating a needle-felted wool miniature world. Every object in frame — skin, hair, furniture, glass, liquid, metal — is constructed from wool fiber, rendered with macro-accurate strand and felt detail. This rule is absolute in every scene.

MATERIAL RULES
Render each surface by its correct fiber construction, and let different finishes sit against each other in the same frame: dense matted felt for skin, walls, and solid props, with individual fiber tips visible up close; regular knit or woven structure for fabric, with visible stitch loops and yarn twist; twisted plied yarn for anything that would normally be rigid or liquid — cables, glass, pours — catching light along each strand. Nothing in this world is smooth, molded plastic, or real glass; everything carries a felt or yarn logic.

HAIR RULE
Hair is always individual yarn strands rooted into a felted scalp, with scalp visible between strands — sparse enough to count, never a solid felted cap. Beards and brows follow the same rule.

CHARACTER DESIGN
Adult proportions, grounded rather than cute — a large head-to-body ratio reads as the wrong tone for this style. Faces carry real age: wrinkles as fiber-ridge compressions, pores as fiber-knots. Establish a character's felt construction, proportions, and color in their first scene and hold it exactly after that.

COMPOSITION
Close, intimate framing by default — shallow depth of field, the near subject sharp to individual fiber, the background a warm soft blur that still reads as wool. Pull back fully only when the scene needs an establishing wide.

LIGHTING
Every scene lit by a practical source visible in frame — a lamp, a window, a sign — giving true blacks in shadow and warm saturated color in the light. Flat, shadowless lighting is out of place here.

MOTION
One clear physical action per scene, paced slow to medium so the fiber's weight and texture reads: a hand drawing through strands, fabric settling under gravity. Camera holds still by default; when a move is called for, commit to it fully.

STYLE TAG (part of every visual description)
wool felt world, needle-felted surfaces, individual yarn-strand hair, macro fiber detail, practical warm lighting, 9:16 vertical$$,
 '/style-previews/wool-felt-world.jpg', true),

-- 10. Anatomy Glow
(null, 'Anatomy Glow',
 'A warm, friendly translucent-body visualization — bones and systems glow softly into view exactly when the story needs them to, never grotesque.',
 array['animation', '3d', 'explainer'],
$$STYLE MASTERPROMPT - ANATOMY GLOW

You are generating a stylized 3D character with translucent, frosted-glass skin and a softly luminous skeleton visible beneath it. Internal structures glow into view only when the story is actually about them — this is a warm, friendly explainer look, never a horror or clinical one.

CHARACTER RULES
Skin reads as frosted translucent glass. Bones are smooth, clean, and faintly luminous. The face stays expressive — warm eyes, real micro-expression — even with the skull visible beneath. Proportions are stylized but anatomically grounded, never grotesque. Establish the character's exact look in the first scene and hold it after that.

THE REVEAL RULE
Only light up an internal structure when the scene's action is actually about it — never as decoration. Light one structure at a time, in the same shot and same character, with no cutaway. Color carries meaning: warm amber or soft pink for something healthy or active, gold or bright warm white for a positive process completing, muted orange for strain, electric blue for a nerve signal. No blood, no visible injury, ever — this stays family-friendly at every moment.

COMPOSITION & LIGHTING
Soft volumetric lighting throughout, with the glowing structure itself acting as a secondary light source in its scene. Cinematic depth of field keeps focus on the character.

MOTION & CAMERA
A slow push toward the face or the glowing structure, a gentle rack-focus toward an internal reveal, a low angle that reads as strength rather than fragility. Handheld drift is fine; nothing jarring or fast.

VOICE & AUDIO
Warm, natural, conversational delivery. A soft rising tone or gentle hum can mark the moment a structure lights up; otherwise, clean minimal ambience.

STYLE TAG (part of every visual description)
anatomy glow, translucent frosted skin, luminous internal structure, warm volumetric light, family-friendly, 9:16 vertical$$,
 '/style-previews/anatomy-glow.jpg', true),

-- 11. Noir Panel
(null, 'Noir Panel',
 'Hard-edged painted illustration with angular shading planes and theatrical, high-contrast lighting — graphic and psychologically charged.',
 array['illustration'],
$$STYLE MASTERPROMPT - NOIR PANEL

You are generating dramatic illustration built from hard angular shading planes and loose painterly brushwork — hand-crafted and graphic, never smooth, never rendered like 3D software.

VISUAL STYLE
- Render: faceted digital illustration, caricature-leaning character design
- Format: 9:16 vertical
- Feel: theatrical, psychologically charged, high-contrast
- Hold: every value shift as a hard angular cut, never a blended gradient

PLANE RULES
Every surface — skin, fabric, walls — breaks into deliberate angular shading planes with hard value cuts. Loose interior sketch lines sit on top, defining folds and structural edges without outlining the whole subject. A visible brushstroke or smear texture lives inside each flat plane so the result reads as painted, not vector. One dominant light source rakes across the scene at a low or side angle, carving sharp lit islands out of deep shadow. Hold the palette tight: two to three colors per scene, shadow leaning one hue, light leaning a contrasting accent, with the eyes carrying the single warmest or brightest note in the frame.

CHARACTER DESIGN
Faces lean toward caricature — elongated features, strong brow, expressive eyes — psychologically heightened rather than grotesque. Eyes stay the most detailed, most lit element in every frame. Establish a character's exact plane structure and dominant shadow hue in their first scene and hold it after that.

COMPOSITION
Tight, close framing by default — subjects fill the vertical frame near its edges. A low or slightly upward angle suits this style's natural sense of presence.

MOTION
Slow, deliberate, slightly stepped movement — closer to hand-drawn animation on twos than to smooth 3D motion. One clear action per scene; camera moves, if used, are slow drifts rather than fast pans.

STYLE TAG (part of every visual description)
noir panel illustration, hard angular shading planes, interior sketch lines, painterly brushwork, dramatic raking light, tight caricature framing, 9:16 vertical$$,
 '/style-previews/noir-panel.jpg', true),

-- 12. Feature 3D
(null, 'Feature 3D',
 'Warm, expressive 3D animated-feature look — any subject gets a face, a personality, and a cinematic internal-reveal beat when the story calls for it.',
 array['animation', '3d'],
$$STYLE MASTERPROMPT - FEATURE 3D

You are generating content in a warm, expressive 3D animated-feature look: soft volumetric lighting, subsurface skin scattering, and detailed but stylized environments.

SUBJECT RULES
The main subject can be anything — a person, an animal, an object, an abstract idea. Interpret freely: a tired muscle fiber becomes a character with a face and a personality just as readily as a person does. Establish the subject's exact look in the first scene and hold it steady across every later scene.

INTERNAL REVEAL BEAT
When the story moves inside a body — an organ, a process, an injury mechanism — cut to a stylized internal visualization in the same render quality: a dark background with a dramatic spotlight on the anatomical subject, color used to carry meaning (healthy tissue warm and glowing, strain desaturated, a nerve signal a bright electric trace). Push the camera in close, like flying through the structure, making it feel large and dramatic. Then return to the main subject.

CHARACTER TREATMENT
Expressive eyes and face regardless of what the subject is, slightly exaggerated proportions, personality carried through posture and small gesture. Keep poses natural and alive, never stiff.

COMPOSITION
Subject centered by default, facing camera unless the scene calls for otherwise, movement natural to whatever the subject physically is.

VOICE & AUDIO
Natural, conversational, confident delivery, consistent across the piece — dry rather than cartoonish. A scene with dialogue carries the line over a quiet room tone; a silent scene holds the room tone alone. Write dialogue in lowercase with delivery notes for emphasis rather than capitals.

STYLE TAG (part of every visual description)
feature 3D animation, cinematic lighting, expressive character, subsurface skin scattering, warm color grade, 9:16 vertical$$,
 '/style-previews/feature-3d.jpg', true),

-- 13. Retro Reel
(null, 'Retro Reel',
 'Hand-painted 1930s-40s cel-animation energy — rubber-hose motion, wobbly inked lines, and genuine broadcast-era imperfection.',
 array['animation'],
$$STYLE MASTERPROMPT - RETRO REEL

You are generating content in a vintage 1930s-1940s hand-painted cel-animation aesthetic: rough, expressive, and intentionally imperfect, as if captured from an old broadcast.

VISUAL STYLE
- Render: hand-painted cel animation, low fidelity, intentional grain and motion softness
- Format: 9:16 vertical
- Hold firmly to the era: no photorealism, no 3D rendering, no crisp modern vector lines, no anime influence, no modern color saturation

CHARACTER RULES
Any subject works — person, animal, object, idea — rendered as a genuine original character for the era, never referencing a specific known copyrighted character. Apply era-accurate squash-and-stretch proportions, thick wobbly hand-inked outlines, expressive rubber-hose limb movement, and a strong, readable silhouette. Establish the character's look in the first scene and hold it after that.

PERIOD TEXTURE
Muted, slightly faded era-accurate color; visible cel grain and paint imperfection; wobbly hand-inked line with thick-to-thin variation; simplified flat-painted backgrounds with loose perspective; flat or minimal shading with no gradient or subsurface work. The mood stays energetic and a little chaotic, true to the era, never polished.

COMPOSITION
Subject centered by default, facing camera unless the scene calls for otherwise. Full-bleed image, no borders or vignette.

MOTION
Keep every action explicit and literal — one clear action per scene, described plainly: what moves, how fast, in which direction. Movement stays expressive rubber-hose animation, but timed simply (slow, medium, fast).

VOICE & AUDIO
Natural, conversational delivery with a touch of period roughness — never pushed into parody. Consistent voice across the piece. A scene with dialogue carries the line over a quiet room tone; a silent scene holds the room tone alone. Lowercase dialogue, delivery notes instead of capitals for emphasis.

STYLE TAG (part of every visual description)
retro reel, hand-painted cel animation, wobbly inked outlines, muted faded palette, cel grain, low-fidelity broadcast feel, 9:16 vertical$$,
 '/style-previews/retro-reel.jpg', true),

-- 14. Grid Studio Explainer
(null, 'Grid Studio Explainer',
 'Semi-realistic 3D explainer shorts staged as small open sets inside one consistent studio — a cobalt-blue measured grid floor and back wall.',
 array['explainer', '3d'],
$$STYLE MASTERPROMPT - GRID STUDIO EXPLAINER

You are generating semi-realistic 3D explainer shots: the look of a game-engine cutscene answering one question per scene. One character, one action, one readable emotion per shot — short plain descriptions beat stacked render vocabulary every time.

THE STUDIO (applies to every scene)
Every scene stands inside one large, otherwise empty studio: a flat cobalt-blue floor and two flat cobalt-blue walls meeting in a corner behind the subject, all three surfaces carrying a precise white measurement grid of thin, evenly spaced lines that follow the surface's own perspective. Small open sets sit inside this studio, dollhouse-style — owning only their two back walls and simple furniture, with the studio's blue grid floor and walls still visible around them. A character with no location stands directly on the grid floor with one or two simple props. The studio drops away only for a full-frame interior/cutaway shot, or when a scene explicitly calls for a different environment.

VISUAL RECIPE
Build each shot as: a plain render-anchor line, one flowing sentence describing the character's emotion, action, posture, and props, a studio sentence placing the open set inside the grid room, and a short technical tail (full figure in frame, flat even daylight, eye-level camera, deep focus, smooth matte textures, realistic proportions, slightly uncanny face). Keep it to one plain sentence per scene — extra render vocabulary weakens rather than strengthens the shot.

CHARACTER RULES
Semi-realistic adults with natural proportions and a slightly uncanny, neutral 3D-character face: real eyes with irises, matte skin, simply groomed hair. One readable emotion per scene, carried mostly through posture and gaze. Ordinary, role-appropriate clothing in flat simple colors. Establish a character's outfit, hair, and build in the first scene and hold it after that.

CAMERA
Full-figure framing by default — the whole character and the set piece fit in frame, feet visibly on the floor. Eye-level, centered, deep focus so the subject, the set, and the grid lines all stay sharp. One deliberate camera move per scene: a slow push, an orbit, a pull-back to reveal scale, or a continuous zoom through a surface into an interior shot.

VOICE & AUDIO
Calm, matter-of-fact narration, short sentences, a curious rather than clinical tone even on an odd or visceral subject. Minimal sound design matched to the scene's one action.

STYLE TAG (part of every visual description)
grid studio explainer, semi-realistic 3D, cobalt-blue measured-grid studio, full figure, deep focus, 9:16 vertical$$,
 '/style-previews/grid-studio-explainer.jpg', true),

-- 15. Pure Product (studio-clean product-only style, rounds out the set)
(null, 'Pure Product',
 'Clean, studio-shot product-first visuals — the product is always the hero, lit and staged like a premium commercial frame.',
 array['product'],
$$STYLE MASTERPROMPT - PURE PRODUCT

You are generating clean, premium studio product photography and video. The product is always the hero of the frame; every other choice in the shot serves it.

VISUAL STYLE
- Render: photoreal studio product photography
- Format: 9:16 vertical
- Feel: premium, clean, intentional — commercial-grade
- Hold the product to correct proportions, true-to-life material and color, label facing camera and legible

STAGING
Build each shot from a simple, considered surface and backdrop that complements the product's own color and material without competing with it — a seamless studio backdrop, a textured natural surface, or a lightly dressed lifestyle surface, chosen to suit the product's category. Props, when used, stay minimal and purposeful: one or two objects that support the product's story, never clutter.

LIGHTING
Soft, directional studio lighting that models the product's form and finish clearly — a visible highlight on glass or metal, true color on matte surfaces, a gentle shadow that grounds the product on its surface.

COMPOSITION
Product centered or on a clear focal third, shot straight-on or at a flattering three-quarter angle, with enough negative space to breathe. Shallow depth of field on close product details; deeper focus when the full product and its context both need to read.

MOTION (for video)
One deliberate camera move per shot — a slow orbit, a steady push-in, a gentle turntable rotation — paced to let the product's finish and form read clearly. No handheld energy here; this style stays composed and controlled throughout.

STYLE TAG (part of every visual description)
pure product, premium studio lighting, hero product framing, clean composition, 9:16 vertical$$,
 '/style-previews/pure-product.jpg', true)

on conflict (name) where org_id is null do update
  set description = excluded.description,
      categories = excluded.categories,
      masterprompt = excluded.masterprompt,
      preview_image_url = excluded.preview_image_url,
      active = excluded.active;

-- M5: platform-wide tone/angle briefs per product category, fed into
-- the generate_ad_scripts prompt as inspiration. Fresh prose written
-- for AutoCut, not ported from Hermes (checked first — Hermes'
-- visual_library category library was almost entirely empty
-- placeholders and covered shot/video direction, not copy tone).
--
-- Not a numbered migration — re-runnable content, same pattern as
-- seed_styles.sql/seed_models.sql/seed_prompts.sql.

insert into public.category_templates (category, tone_notes) values
('supplements', 'Lead with the specific outcome, not the ingredient list — energy, sleep, focus, immunity. Skeptical-buyer-first: acknowledge "yet another supplement" fatigue before making a claim. Avoid medical/cure language; frame as support, not treatment. Everyday routine framing (morning, gym bag, desk drawer) outperforms clinical framing.'),
('skincare', 'Visual, sensory language — texture, glow, before/after state — works harder than ingredient science. Short, confident hooks beat long explanations. Address a visible, specific insecurity (not a vague "better skin") without being unkind about it. Routine-integration CTAs ("add this one step") convert better than hard-sell CTAs.'),
('fitness', 'Identity and results language — who this makes you, not just what it does. Hooks built on a relatable struggle (plateau, soreness, no time) land better than feature lists. Keep CTA action-oriented and immediate ("start today") rather than informational.'),
('pain_relief', 'Open on the specific physical sensation, named precisely (the exact ache, the exact moment it happens), not a generic "in pain" statement. Relief-focused, not miracle-focused — credibility matters more than hype here. Avoid overpromising a cure; "finally get through the day" beats "pain gone forever."'),
('wearables', 'Lead with the single stat or moment of insight the device surfaces, not the full feature list. Tech-forward but human — show what changes in a normal day, not a spec sheet. Comparison framing against "guessing" or "not knowing" works well as a hook.'),
('home_products', 'Before/after or problem/solution framing is almost always the strongest hook here — show the mess, the clutter, the hassle first. Time-saved and effort-saved language outperforms feature language. Keep CTA practical ("grab one for the kitchen") over aspirational.'),
('apparel', 'Fit, feel, and occasion-specific framing beat generic style claims. Hooks that name a specific frustration (doesn''t fit right, falls apart, see-through) outperform "look great" openers. Social proof and versatility ("wear it three ways") are strong body-copy angles.'),
('beauty', 'Fast transformation or fast routine framing performs well — speed and simplicity are the selling point as much as the result. Confident, slightly playful tone suits this category more than clinical. Avoid overloading the hook with more than one claim.'),
('food_beverage', 'Taste and craving language first, functional benefit second — this category sells on appetite appeal before anything else. Everyday-moment hooks (afternoon slump, post-workout, late night) work better than abstract benefit claims. Keep CTA sensory ("try it ice cold") over instructional.'),
('other', 'No category-specific angle on file yet — generate from the brand context, customer profile and product facts alone. Favor a clear, concrete claim over a generic one, and keep the hook specific to this product rather than borrowing a generic category hook.')
on conflict (category) do update
  set tone_notes = excluded.tone_notes;

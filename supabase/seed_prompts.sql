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

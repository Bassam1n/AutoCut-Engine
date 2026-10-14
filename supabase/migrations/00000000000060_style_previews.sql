-- Public bucket for style preview images (styles.preview_image_url).
-- Previews are marketing-grade sample frames, not customer content, so
-- they're public like avatars: the Styles gallery and new-ad picker load
-- them with a plain <img>, no signed URLs. Writes happen server-side with
-- the service role only (generateStylePreview), so no insert policy.
insert into storage.buckets (id, name, public)
values ('style-previews', 'style-previews', true)
on conflict (id) do update set public = true;

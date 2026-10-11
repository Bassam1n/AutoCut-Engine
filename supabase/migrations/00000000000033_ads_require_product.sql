-- M5: ads.product_id becomes required. The original M1 schema
-- (00000000000008_ads_scenes_assets.sql) made it optional to allow a
-- brand-level ad with no specific product — the user corrected this
-- decision when M5 routing came up: every ad in AutoCut is about a
-- specific product, nested under it (brand -> product -> ads), not a
-- brand-level concept. Confirmed zero live rows in public.ads before
-- this migration, so no backfill is needed — this is a clean
-- constraint tightening, not a data migration.
alter table public.ads
  alter column product_id set not null;

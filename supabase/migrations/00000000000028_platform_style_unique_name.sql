-- M2/M3-adjacent: a unique index on styles.name scoped to platform
-- seeds only (org_id is null) — needed so the platform style seed
-- script (supabase/seed_styles.sql, not a numbered migration since
-- it's re-runnable content, not a one-way schema change) can upsert
-- idempotently via ON CONFLICT instead of accumulating duplicate rows
-- on every re-run. Org-owned styles are left unconstrained, matching
-- brands/products/customers, none of which enforce unique names
-- within an org.
create unique index styles_platform_seed_name_key
  on public.styles (name)
  where org_id is null;

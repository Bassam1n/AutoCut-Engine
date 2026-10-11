-- M5: ads list management (rename, archive). Spec §4's own stated
-- rule: "Archive, never delete. Regenerated assets get a new version
-- and the old one is flagged archived. Work invalidated upstream is
-- marked stale, not deleted." — applied to ads themselves the same
-- way: archived (soft-hide from the list), not a hard delete, so
-- scripts/scenes/concepts/cast/spend history under an ad is never
-- lost by accident.
--
-- ads has no name/title field — the list derives a label from the
-- first hook or brief idea. Renaming needs a real field to override
-- that fallback.

alter table public.ads add column name text;
alter table public.ads add column archived boolean not null default false;

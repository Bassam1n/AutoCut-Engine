-- Auto-edit: keep the raw worker error of each failed attempt for
-- operators. The editor sees auto_edit_runs.error (plain language); the
-- app never selects this column.

alter table public.auto_edit_runs add column error_detail text;
comment on column public.auto_edit_runs.error_detail is
  'Raw worker errors, one line per failed attempt (operators only; the UI shows error).';

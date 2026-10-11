-- M5: in-app prompt editor. prompt_versions has no write policy for
-- any role (correctly — spec calls it "service-role-write-only"), so
-- a platform admin can't just UPDATE from the browser; this RPC is
-- the sanctioned write path, same shape as other admin-gated RPCs
-- (is_platform_admin() check, SECURITY DEFINER). Always INSERTS a new
-- version rather than overwriting an existing row — prompt_versions
-- is meant to keep history (every llm.call() records which version it
-- used), so editing a prompt must never destroy what an earlier call
-- actually ran against.
create or replace function public.save_prompt_version(
  target_task text,
  new_body text
)
returns public.prompt_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  next_version integer;
  new_row public.prompt_versions;
begin
  if not public.is_platform_admin() then
    raise exception 'save_prompt_version can only be called by a platform admin';
  end if;

  select coalesce(max(version), 0) + 1 into next_version
  from public.prompt_versions
  where task = target_task;

  update public.prompt_versions
  set active = false
  where task = target_task and active = true;

  insert into public.prompt_versions (task, version, body, active)
  values (target_task, next_version, new_body, true)
  returning * into new_row;

  return new_row;
end;
$$;

revoke execute on function public.save_prompt_version(text, text) from anon;
grant execute on function public.save_prompt_version(text, text) to authenticated;


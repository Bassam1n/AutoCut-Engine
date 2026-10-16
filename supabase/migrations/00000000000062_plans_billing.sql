-- Plans, limits and manual billing.
--
-- Pricing is per agency, not per seat: Starter ($97, 3 brands),
-- Agency ($297, unlimited brands), Studio ($497, white label). Payments
-- are taken in person, so there is no payment processor: a platform
-- admin records each payment, which moves the agency's paid_until
-- date forward. Limits are stored on the org (seat_cap, brand_cap,
-- storage_quota_gb) so a custom deal is just different numbers; the
-- plan's defaults only pre-fill them.
--
-- Enforcement:
--   brands   trigger on public.brands (active brands only)
--   seats    existing seat_cap check in invite_member
--   storage  claim_paid_media_job(org) before any media generation
--   unpaid   claim_paid_job refuses all paid work 7 days after
--            paid_until (a null paid_until is never enforced)

-- ---------------------------------------------------------------
-- Plans
-- ---------------------------------------------------------------

alter table public.orgs drop constraint if exists orgs_plan_check;
update public.orgs set plan = 'agency' where plan = 'pro';
update public.orgs set plan = 'studio' where plan = 'enterprise';
alter table public.orgs add constraint orgs_plan_check
  check (plan in ('trial', 'starter', 'agency', 'studio', 'custom'));

alter table public.orgs add column if not exists brand_cap integer
  check (brand_cap is null or brand_cap > 0);
alter table public.orgs add column if not exists storage_quota_gb integer
  check (storage_quota_gb is null or storage_quota_gb > 0);
alter table public.orgs add column if not exists paid_until date;

-- ---------------------------------------------------------------
-- Payments (recorded by a platform admin, read by the agency's
-- owner and admins)
-- ---------------------------------------------------------------

create table if not exists public.billing_payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  amount numeric(12, 2) not null check (amount >= 0),
  currency text not null default 'USD' check (char_length(currency) between 3 and 5),
  paid_on date not null default current_date,
  period_end date not null,
  method text not null default 'cash' check (method in ('cash', 'bank_transfer', 'card', 'other')),
  note text check (note is null or char_length(note) <= 1000),
  recorded_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  voided_at timestamptz
);

create index if not exists billing_payments_org_idx on public.billing_payments (org_id, paid_on desc);

alter table public.billing_payments enable row level security;

create policy billing_payments_select on public.billing_payments
  for select using (public.is_platform_admin() or public.is_org_admin(org_id));

-- ---------------------------------------------------------------
-- Storage usage: every org file lives under "<org_id>/..." in the
-- renders and refs buckets.
-- ---------------------------------------------------------------

create or replace function public.org_storage_bytes(target_org_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public, storage
as $$
  select coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint
  from storage.objects o
  where o.bucket_id in ('renders', 'refs')
    and o.name like target_org_id::text || '/%';
$$;

revoke execute on function public.org_storage_bytes(uuid) from anon, authenticated;

-- What the agency's Plan & usage screen and the platform admin show.
create or replace function public.org_usage(target_org_id uuid)
returns table (
  plan text,
  paid_until date,
  seat_cap integer,
  seats_used integer,
  brand_cap integer,
  brands_used integer,
  storage_quota_gb integer,
  storage_bytes bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.is_platform_admin() or public.is_org_admin(target_org_id) or auth.role() = 'service_role') then
    raise exception 'only an owner or admin of this agency can view its usage';
  end if;

  return query
  select o.plan, o.paid_until, o.seat_cap, public.org_seat_usage(o.id),
         o.brand_cap,
         (select count(*)::int from public.brands b where b.org_id = o.id and b.active),
         o.storage_quota_gb, public.org_storage_bytes(o.id)
  from public.orgs o
  where o.id = target_org_id;
end;
$$;

grant execute on function public.org_usage(uuid) to authenticated;

-- ---------------------------------------------------------------
-- Brand cap
-- ---------------------------------------------------------------

create or replace function public.enforce_brand_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cap integer;
  used integer;
begin
  if not new.active then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.active then
    return new;
  end if;

  select brand_cap into cap from public.orgs where id = new.org_id;
  if cap is null then
    return new;
  end if;

  select count(*) into used from public.brands
  where org_id = new.org_id and active and id <> new.id;

  if used >= cap then
    raise exception 'brand_cap_reached';
  end if;
  return new;
end;
$$;

create trigger brands_enforce_cap
  before insert or update of active on public.brands
  for each row execute function public.enforce_brand_cap();

-- ---------------------------------------------------------------
-- Paid job guard: adds the unpaid and storage checks.
-- ---------------------------------------------------------------

create or replace function public.claim_paid_job(target_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org_row public.orgs;
begin
  if auth.role() <> 'service_role' then
    raise exception 'claim_paid_job can only be called by the service role';
  end if;

  select * into org_row from public.orgs where id = target_org_id;

  if org_row.id is null then
    raise exception 'org not found';
  end if;

  if org_row.suspended_at is not null then
    raise exception 'org_suspended: this agency''s account is suspended';
  end if;

  if org_row.paid_until is not null and org_row.paid_until + 7 < current_date then
    raise exception 'org_unpaid: the AutoCut subscription ended on %', to_char(org_row.paid_until, 'FMDD Mon YYYY');
  end if;

  if org_row.paused then
    raise exception 'org_paused: %', coalesce(org_row.pause_reason, 'spend guard has paused this org');
  end if;
end;
$$;

-- Media generation also needs room in the agency's storage quota.
create or replace function public.claim_paid_media_job(target_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  quota integer;
begin
  perform public.claim_paid_job(target_org_id);
  select storage_quota_gb into quota from public.orgs where id = target_org_id;
  if quota is not null and public.org_storage_bytes(target_org_id) >= quota::bigint * 1000000000 then
    raise exception 'org_storage_full: this agency has used its % GB of storage', quota;
  end if;
end;
$$;

revoke execute on function public.claim_paid_media_job(uuid) from anon, authenticated;

-- ---------------------------------------------------------------
-- Platform admin: set plan and limits, record and void payments.
-- ---------------------------------------------------------------

create or replace function public.platform_set_org_plan(
  target_org_id uuid,
  new_plan text,
  new_seat_cap integer,
  new_brand_cap integer,
  new_storage_quota_gb integer
)
returns public.orgs
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_org public.orgs;
begin
  if not public.is_platform_admin() then
    raise exception 'only a platform admin can change an agency''s plan';
  end if;

  update public.orgs
  set plan = new_plan,
      seat_cap = new_seat_cap,
      brand_cap = new_brand_cap,
      storage_quota_gb = new_storage_quota_gb
  where id = target_org_id
  returning * into updated_org;

  if updated_org.id is null then
    raise exception 'agency not found';
  end if;

  insert into public.audit_log (org_id, actor, action, target)
  values (target_org_id, auth.uid(), 'plan_changed',
          format('%s: %s seats, %s brands, %s GB', new_plan,
                 coalesce(new_seat_cap::text, 'no'), coalesce(new_brand_cap::text, 'unlimited'),
                 coalesce(new_storage_quota_gb::text, 'unlimited')));

  return updated_org;
end;
$$;

create or replace function public.platform_record_payment(
  target_org_id uuid,
  pay_amount numeric,
  pay_currency text,
  pay_paid_on date,
  pay_period_end date,
  pay_method text,
  pay_note text
)
returns public.billing_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  new_payment public.billing_payments;
begin
  if not public.is_platform_admin() then
    raise exception 'only a platform admin can record a payment';
  end if;

  insert into public.billing_payments (org_id, amount, currency, paid_on, period_end, method, note, recorded_by)
  values (target_org_id, pay_amount, upper(trim(pay_currency)), pay_paid_on, pay_period_end, pay_method,
          nullif(trim(coalesce(pay_note, '')), ''), auth.uid())
  returning * into new_payment;

  update public.orgs
  set paid_until = greatest(coalesce(paid_until, pay_period_end), pay_period_end)
  where id = target_org_id;

  insert into public.audit_log (org_id, actor, action, target)
  values (target_org_id, auth.uid(), 'payment_recorded',
          format('%s %s, paid until %s', upper(trim(pay_currency)), pay_amount, pay_period_end));

  return new_payment;
end;
$$;

create or replace function public.platform_void_payment(target_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  payment public.billing_payments;
begin
  if not public.is_platform_admin() then
    raise exception 'only a platform admin can void a payment';
  end if;

  update public.billing_payments set voided_at = now()
  where id = target_payment_id and voided_at is null
  returning * into payment;
  if payment.id is null then
    raise exception 'payment not found';
  end if;

  update public.orgs
  set paid_until = (select max(period_end) from public.billing_payments where org_id = payment.org_id and voided_at is null)
  where id = payment.org_id;

  insert into public.audit_log (org_id, actor, action, target)
  values (payment.org_id, auth.uid(), 'payment_voided',
          format('%s %s, paid until %s', payment.currency, payment.amount, payment.period_end));
end;
$$;

-- Set paid_until directly, e.g. to start a trial or extend as a favour.
create or replace function public.platform_set_paid_until(target_org_id uuid, new_paid_until date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'only a platform admin can change the paid until date';
  end if;

  update public.orgs set paid_until = new_paid_until where id = target_org_id;

  insert into public.audit_log (org_id, actor, action, target)
  values (target_org_id, auth.uid(), 'paid_until_changed', coalesce(new_paid_until::text, 'not enforced'));
end;
$$;

-- ---------------------------------------------------------------
-- Archived file cleanup: when an asset was archived, so the daily
-- cleanup job can delete files archived more than 90 days ago.
-- ---------------------------------------------------------------

alter table public.assets add column if not exists archived_at timestamptz;
update public.assets set archived_at = now() where archived and archived_at is null;

create or replace function public.set_asset_archived_at()
returns trigger
language plpgsql
as $$
begin
  if new.archived and (tg_op = 'INSERT' or not old.archived) then
    new.archived_at := now();
  elsif not new.archived then
    new.archived_at := null;
  end if;
  return new;
end;
$$;

create trigger assets_set_archived_at
  before insert or update of archived on public.assets
  for each row execute function public.set_asset_archived_at();

-- Archived long enough, and nothing still points at it (library, cast,
-- style reference). Service role only: the cleanup job deletes the
-- file through the Storage API, then the row.
create or replace function public.purgeable_archived_assets(older_than_days integer default 90, max_rows integer default 500)
returns table (asset_id uuid, org_id uuid, storage_path text)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.org_id, a.storage_path
  from public.assets a
  where a.archived
    and a.archived_at < now() - make_interval(days => older_than_days)
    and not exists (select 1 from public.library_items l where l.asset_id = a.id)
    and not exists (select 1 from public.cast_members c where c.ref_asset_id = a.id or c.sheet_asset_id = a.id)
    and not exists (select 1 from public.brand_cast_members bc where bc.ref_asset_id = a.id or bc.sheet_asset_id = a.id)
    and not exists (select 1 from public.styles s where s.reference_asset_id = a.id)
  order by a.archived_at
  limit max_rows;
$$;

revoke execute on function public.purgeable_archived_assets(integer, integer) from anon, authenticated;

-- ---------------------------------------------------------------
-- Platform admin: billing columns per agency (merged with
-- platform_org_overview in the app).
-- ---------------------------------------------------------------

create or replace function public.platform_org_billing()
returns table (org_id uuid, brand_cap integer, storage_quota_gb integer, storage_bytes bigint, paid_until date)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'only a platform admin can view all agencies';
  end if;

  return query
  select o.id, o.brand_cap, o.storage_quota_gb, public.org_storage_bytes(o.id), o.paid_until
  from public.orgs o;
end;
$$;

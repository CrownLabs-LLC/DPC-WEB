-- DPC-WEB promotional campaign only; no membership, ledger, or finance writes.
begin;

create table public.glass_campaign_contacts (
  id uuid primary key default gen_random_uuid(),
  campaign text not null default 'glass-2026' check (campaign = 'glass-2026'),
  email text not null check (email = lower(btrim(email)) and length(email) between 3 and 254
    and email ~ '^[^[:space:]@[:cntrl:]]+@[^[:space:]@[:cntrl:]]+\.[^[:space:]@[:cntrl:]]+$'),
  marketing_opt_in boolean not null,
  preference_occurred_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (campaign, email)
);

create table public.glass_campaign_pickups (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null unique references public.glass_campaign_contacts(id),
  origin text not null default 'browser' check (origin = 'browser'),
  occurred_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp()
);

-- Request identity makes ambiguous network retries safe, including after a later
-- deliberate preference change. There is intentionally no public lookup.
create table public.glass_campaign_submissions (
  id uuid primary key,
  contact_id uuid not null references public.glass_campaign_contacts(id),
  marketing_opt_in boolean not null,
  marketing_changed boolean not null,
  wording_version text not null check (wording_version = 'glass-2026-09-24-v1'),
  created_at timestamptz not null default clock_timestamp()
);
create index glass_campaign_submissions_contact_idx on public.glass_campaign_submissions(contact_id);

create table public.glass_campaign_preference_events (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.glass_campaign_contacts(id),
  submission_id uuid not null unique references public.glass_campaign_submissions(id),
  marketing_opt_in boolean not null,
  basis text not null check (basis in ('initial_default', 'explicit_change')),
  wording_version text not null,
  wording text not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp()
);
create index glass_campaign_preference_contact_idx on public.glass_campaign_preference_events(contact_id);

-- Daily keyed hashes only: no raw IP, email, or link to a campaign contact.
create table public.glass_campaign_rate_limits (
  id uuid primary key default gen_random_uuid(),
  rate_key text not null unique check (rate_key ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  submissions integer not null check (submissions between 1 and 30),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create index glass_campaign_rate_expiry_idx on public.glass_campaign_rate_limits(window_started_at);

create function public.glass_campaign_touch_updated_at() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin new.updated_at := clock_timestamp(); return new; end;
$$;
create trigger glass_campaign_contact_updated before update on public.glass_campaign_contacts
for each row execute function public.glass_campaign_touch_updated_at();
create trigger glass_campaign_rate_updated before update on public.glass_campaign_rate_limits
for each row execute function public.glass_campaign_touch_updated_at();

alter table public.glass_campaign_contacts enable row level security;
alter table public.glass_campaign_pickups enable row level security;
alter table public.glass_campaign_submissions enable row level security;
alter table public.glass_campaign_preference_events enable row level security;
alter table public.glass_campaign_rate_limits enable row level security;
-- Supabase default privileges can include service-role UPDATE/DELETE; remove
-- those defaults before granting the narrower append-only history contract.
revoke all on public.glass_campaign_contacts, public.glass_campaign_pickups,
  public.glass_campaign_submissions, public.glass_campaign_preference_events,
  public.glass_campaign_rate_limits from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.glass_campaign_rate_limits to service_role;
grant select, insert, update on public.glass_campaign_contacts to service_role;
grant select, insert on public.glass_campaign_pickups, public.glass_campaign_submissions,
  public.glass_campaign_preference_events to service_role;

create function public.register_glass_pickup(p_request_id uuid, p_email text,
  p_marketing_opt_in boolean, p_marketing_changed boolean, p_wording_version text, p_rate_key text)
returns boolean language plpgsql security invoker set search_path = pg_catalog, public as $$
declare
  v_email text := lower(btrim(p_email));
  v_contact uuid;
  v_new boolean;
  v_prior public.glass_campaign_submissions%rowtype;
  v_now timestamptz;
  v_bucket uuid;
begin
  if p_request_id is null or p_email is null or p_marketing_opt_in is null
    or p_marketing_changed is null or p_wording_version is distinct from 'glass-2026-09-24-v1'
    or (not p_marketing_opt_in and not p_marketing_changed)
    or p_rate_key is null or p_rate_key !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid pickup submission' using errcode = '22023';
  end if;
  -- Atomic shared-network limit across server instances, including retries.
  -- A full bucket returns before any contact, pickup or preference mutation.
  v_now := clock_timestamp();
  insert into public.glass_campaign_rate_limits as rate(rate_key, window_started_at, submissions)
    values(p_rate_key, v_now, 1)
    on conflict(rate_key) do update set
      window_started_at = case when rate.window_started_at <= v_now - interval '1 minute' then v_now else rate.window_started_at end,
      submissions = case when rate.window_started_at <= v_now - interval '1 minute' then 1 else rate.submissions + 1 end
    where rate.window_started_at <= v_now - interval '1 minute' or rate.submissions < 30
    returning id into v_bucket;
  if not found then return false; end if;
  -- Bounded opportunistic cleanup; no scheduler or extra service required.
  delete from public.glass_campaign_rate_limits where id in (
    select id from public.glass_campaign_rate_limits
    where window_started_at < v_now - interval '2 days'
    order by window_started_at limit 100 for update skip locked
  );
  -- All paths take rate, request, then contact locks in this order.
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select * into v_prior from public.glass_campaign_submissions where id = p_request_id;
  if found then
    if v_prior.marketing_opt_in is distinct from p_marketing_opt_in
      or v_prior.marketing_changed is distinct from p_marketing_changed
      or v_prior.wording_version is distinct from p_wording_version
      or not exists (select 1 from public.glass_campaign_contacts where id = v_prior.contact_id and email = v_email) then
      raise exception 'Request intent mismatch' using errcode = '22023';
    end if;
    return true;
  end if;

  insert into public.glass_campaign_contacts(email, marketing_opt_in)
    values(v_email, p_marketing_opt_in) on conflict(campaign, email) do nothing returning id into v_contact;
  v_new := found;
  select id into strict v_contact from public.glass_campaign_contacts
    where campaign = 'glass-2026' and email = v_email for update;
  v_now := clock_timestamp();
  insert into public.glass_campaign_pickups(contact_id) values(v_contact) on conflict(contact_id) do nothing;
  insert into public.glass_campaign_submissions(id, contact_id, marketing_opt_in, marketing_changed, wording_version)
    values(p_request_id, v_contact, p_marketing_opt_in, p_marketing_changed, p_wording_version);
  if v_new or p_marketing_changed then
    update public.glass_campaign_contacts set marketing_opt_in = p_marketing_opt_in,
      preference_occurred_at = v_now where id = v_contact;
    insert into public.glass_campaign_preference_events(contact_id, submission_id, marketing_opt_in,
      basis, wording_version, wording, occurred_at)
    values(v_contact, p_request_id, p_marketing_opt_in,
      case when p_marketing_changed then 'explicit_change' else 'initial_default' end,
      p_wording_version, 'Email me DPC news and upcoming events.', v_now);
  end if;
  return true;
end;
$$;
revoke all on function public.glass_campaign_touch_updated_at() from public, anon, authenticated;
revoke all on function public.register_glass_pickup(uuid,text,boolean,boolean,text,text) from public, anon, authenticated;
grant execute on function public.register_glass_pickup(uuid,text,boolean,boolean,text,text) to service_role;
comment on table public.glass_campaign_pickups is 'One submitted pickup per campaign contact; no location tracking or proof of physical handover.';
comment on table public.glass_campaign_preference_events is 'Append-only marketing choices; not authorization to bypass downstream suppression.';
notify pgrst, 'reload schema';
commit;

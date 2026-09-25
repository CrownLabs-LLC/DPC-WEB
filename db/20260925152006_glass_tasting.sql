-- Promotional campaign only. No membership, ledger, arrival or finance writes.
begin;

create function public.glass_tasting_dates() returns date[]
language sql immutable security invoker set search_path = pg_catalog as $$
  select array['2026-09-29','2026-09-30','2026-10-06','2026-10-13','2026-10-14']::date[];
$$;
create function public.glass_tasting_now() returns timestamptz
language sql volatile security invoker set search_path = pg_catalog as $$
  select clock_timestamp();
$$;

alter table public.glass_campaign_submissions
  add column kind text not null default 'pickup',
  add column restaurant text,
  add column event_date date,
  add constraint glass_campaign_submission_kind check (
    (kind = 'pickup' and restaurant is null and event_date is null)
    or (kind = 'tasting' and restaurant is not null and event_date is not null
      and restaurant in ('demitris-taverna','swirl-on-the-square','calamari-bistro-bar','l-campo')
      and event_date = any(public.glass_tasting_dates()))
  );

create table public.glass_campaign_tastings (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.glass_campaign_contacts(id),
  restaurant text not null check (restaurant in ('demitris-taverna','swirl-on-the-square','calamari-bistro-bar','l-campo')),
  event_date date not null check (event_date = any(public.glass_tasting_dates())),
  origin text not null default 'browser' check (origin = 'browser'),
  occurred_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  unique (contact_id, restaurant, event_date)
);
alter table public.glass_campaign_tastings enable row level security;
revoke all on public.glass_campaign_tastings from public, anon, authenticated, service_role;
grant select, insert on public.glass_campaign_tastings to service_role;

create function public.register_glass_tasting(p_request_id uuid, p_email text,
  p_marketing_opt_in boolean, p_marketing_changed boolean, p_wording_version text,
  p_restaurant text, p_rate_key text)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare
  v_email text := lower(btrim(p_email));
  v_contact uuid;
  v_new boolean;
  v_prior public.glass_campaign_submissions%rowtype;
  v_now timestamptz := public.glass_tasting_now();
  v_date date := (v_now at time zone 'America/Los_Angeles')::date;
  v_bucket uuid;
begin
  if p_request_id is null or p_email is null or p_marketing_opt_in is null
    or p_marketing_changed is null or p_wording_version is distinct from 'glass-2026-09-24-v1'
    or (not p_marketing_opt_in and not p_marketing_changed)
    or p_restaurant is null or p_restaurant not in ('demitris-taverna','swirl-on-the-square','calamari-bistro-bar','l-campo')
    or p_rate_key is null or p_rate_key !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid tasting submission' using errcode = '22023';
  end if;
  if not (v_date = any(public.glass_tasting_dates())) then
    return jsonb_build_object('status', 'closed');
  end if;

  -- Same lock order as pickup: network bucket, request identity, contact.
  insert into public.glass_campaign_rate_limits as rate(rate_key, window_started_at, submissions)
    values(p_rate_key, clock_timestamp(), 1)
    on conflict(rate_key) do update set
      window_started_at = case when rate.window_started_at <= clock_timestamp() - interval '1 minute' then clock_timestamp() else rate.window_started_at end,
      submissions = case when rate.window_started_at <= clock_timestamp() - interval '1 minute' then 1 else rate.submissions + 1 end
    where rate.window_started_at <= clock_timestamp() - interval '1 minute' or rate.submissions < 30
    returning id into v_bucket;
  if not found then return jsonb_build_object('status', 'limited'); end if;
  delete from public.glass_campaign_rate_limits where id in (
    select id from public.glass_campaign_rate_limits
    where window_started_at < clock_timestamp() - interval '2 days'
    order by window_started_at limit 100 for update skip locked
  );
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select * into v_prior from public.glass_campaign_submissions where id = p_request_id;
  if found then
    if v_prior.kind <> 'tasting' or v_prior.restaurant is distinct from p_restaurant
      or v_prior.marketing_opt_in is distinct from p_marketing_opt_in
      or v_prior.marketing_changed is distinct from p_marketing_changed
      or v_prior.wording_version is distinct from p_wording_version
      or not exists (select 1 from public.glass_campaign_contacts where id = v_prior.contact_id and email = v_email) then
      raise exception 'Request intent mismatch' using errcode = '22023';
    end if;
    if v_prior.event_date is distinct from v_date then
      return jsonb_build_object('status', 'expired');
    end if;
  else
    -- Roll back contact insertion too if a lock wait crosses midnight.
    begin
      insert into public.glass_campaign_contacts(email, marketing_opt_in)
        values(v_email, p_marketing_opt_in) on conflict(campaign, email) do nothing returning id into v_contact;
      v_new := found;
      select id into strict v_contact from public.glass_campaign_contacts
        where campaign = 'glass-2026' and email = v_email for update;
      v_now := public.glass_tasting_now();
      if (v_now at time zone 'America/Los_Angeles')::date <> v_date then
        raise exception 'Tasting date changed' using errcode = 'PT409';
      end if;
      insert into public.glass_campaign_tastings(contact_id, restaurant, event_date, occurred_at)
        values(v_contact, p_restaurant, v_date, v_now)
        on conflict(contact_id, restaurant, event_date) do nothing;
      insert into public.glass_campaign_submissions(id, contact_id, marketing_opt_in, marketing_changed, wording_version, kind, restaurant, event_date)
        values(p_request_id, v_contact, p_marketing_opt_in, p_marketing_changed, p_wording_version, 'tasting', p_restaurant, v_date);
      if v_new or p_marketing_changed then
        update public.glass_campaign_contacts set marketing_opt_in = p_marketing_opt_in,
          preference_occurred_at = v_now where id = v_contact;
        insert into public.glass_campaign_preference_events(contact_id, submission_id, marketing_opt_in,
          basis, wording_version, wording, occurred_at)
        values(v_contact, p_request_id, p_marketing_opt_in,
          case when p_marketing_changed then 'explicit_change' else 'initial_default' end,
          p_wording_version, 'Email me DPC news and upcoming events.', v_now);
      end if;
    exception when sqlstate 'PT409' then
      return jsonb_build_object('status', 'closed');
    end;
  end if;
  v_now := public.glass_tasting_now();
  if (v_now at time zone 'America/Los_Angeles')::date <> v_date then
    return jsonb_build_object('status', 'expired');
  end if;
  -- Identical new/repeat response, without contact IDs or original timestamps.
  return jsonb_build_object('status', 'confirmed', 'date', v_date, 'serverNow', v_now,
    'validUntil', (v_date + 1)::timestamp at time zone 'America/Los_Angeles');
end;
$$;

revoke all on function public.glass_tasting_dates(), public.glass_tasting_now(),
  public.register_glass_tasting(uuid,text,boolean,boolean,text,text,text) from public, anon, authenticated;
grant execute on function public.glass_tasting_dates(), public.glass_tasting_now(),
  public.register_glass_tasting(uuid,text,boolean,boolean,text,text,text) to service_role;
comment on table public.glass_campaign_tastings is 'One submitted tasting check-in per campaign email, restaurant and eligible Pacific date; not proof of service.';

-- The existing pickup function is replaced below with one additional kind guard.
create or replace function public.register_glass_pickup(p_request_id uuid, p_email text,
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
    if v_prior.kind <> 'pickup' or v_prior.marketing_opt_in is distinct from p_marketing_opt_in
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
notify pgrst, 'reload schema';
commit;

-- Read-only campaign reporting. Authenticated admin authorization is enforced
-- by the website endpoint before invoking this service-role-only function.
begin;

create function public.read_glass_campaign_report(p_kind text)
returns jsonb language plpgsql stable security invoker
set search_path = pg_catalog, public as $$
declare
  v_rows jsonb;
  v_result jsonb;
begin
  if p_kind = 'summary' then
    select jsonb_build_object(
      'pickups', (select count(*) from public.glass_campaign_pickups),
      'tastings', (select count(*) from public.glass_campaign_tastings),
      'emails', (select count(*) from public.glass_campaign_contacts),
      'marketingContacts', (select count(*) from public.glass_campaign_contacts where marketing_opt_in is true),
      'repeatTasters', (select count(*) from (
        select contact_id from public.glass_campaign_tastings group by contact_id having count(*) > 1
      ) repeated),
      'byRestaurantDate', (select jsonb_agg(to_jsonb(grid) order by event_date, restaurant) from (
        select d.event_date, r.restaurant, count(t.id) as tastings
        from unnest(public.glass_tasting_dates()) d(event_date)
        cross join (values ('demitris-taverna'), ('swirl-on-the-square'), ('calamari-bistro-bar'), ('l-campo')) r(restaurant)
        left join public.glass_campaign_tastings t on t.event_date = d.event_date and t.restaurant = r.restaurant
        group by d.event_date, r.restaurant
      ) grid)
    ) into v_result;
    return v_result || jsonb_build_object('kind', p_kind, 'asOf', statement_timestamp());
  elsif p_kind = 'participation' then
    select coalesce(jsonb_agg(to_jsonb(records) order by event_date, record_type, restaurant, email, record_id), '[]'::jsonb)
    into v_rows from (
      select p.id as record_id, 'pickup'::text as record_type,
        (p.occurred_at at time zone 'America/Los_Angeles')::date as event_date,
        c.email, null::text as restaurant, p.origin, p.created_at as recorded_at
      from public.glass_campaign_pickups p join public.glass_campaign_contacts c on c.id = p.contact_id
      union all
      select t.id, 'tasting', t.event_date, c.email, t.restaurant, t.origin, t.created_at
      from public.glass_campaign_tastings t join public.glass_campaign_contacts c on c.id = t.contact_id
    ) records;
  elsif p_kind = 'marketing' then
    select coalesce(jsonb_agg(to_jsonb(records) order by email), '[]'::jsonb)
    into v_rows from (
      select c.email, c.marketing_opt_in, choice.basis as choice_basis,
        choice.wording, choice.wording_version,
        choice.occurred_at as choice_occurred_at, choice.created_at as choice_recorded_at
      from public.glass_campaign_contacts c
      left join lateral (
        select e.basis, e.wording, e.wording_version, e.occurred_at, e.created_at
        from public.glass_campaign_preference_events e
        where e.contact_id = c.id and e.marketing_opt_in = c.marketing_opt_in
          and e.occurred_at = c.preference_occurred_at
        order by e.created_at desc, e.id desc limit 1
      ) choice on true
      where c.marketing_opt_in is true
    ) records;
  else
    raise exception 'Unknown report' using errcode = '22023';
  end if;
  -- One scalar JSON result avoids the Data API's default set-of-rows cap.
  -- STABLE uses the calling statement's MVCC snapshot for every read above.
  return jsonb_build_object('kind', p_kind, 'asOf', statement_timestamp(),
    'total', jsonb_array_length(v_rows), 'rows', v_rows);
end;
$$;

revoke all on function public.read_glass_campaign_report(text) from public, anon, authenticated;
grant execute on function public.read_glass_campaign_report(text) to service_role;
comment on function public.read_glass_campaign_report(text) is 'Read-only complete campaign snapshot, service role only after server admin authorization. No membership or financial reads.';
notify pgrst, 'reload schema';
commit;

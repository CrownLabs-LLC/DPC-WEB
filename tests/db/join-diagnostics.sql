-- Used only in the disposable container created by npm run test:db.
do $$
begin
  if (select count(*) from site_events) <> 2 then raise exception 'Migration lost existing events'; end if;
  begin
    insert into site_events(event, diagnostics) values ('join_error', '{"message":"raw provider text"}');
    raise exception 'Unexpected diagnostic keys accepted';
  exception when check_violation then null; end;
  begin
    insert into site_events(event, diagnostics) values ('join_error', '[]');
    raise exception 'Non-object diagnostics accepted';
  exception when check_violation then null; end;
  begin
    insert into site_events(event, diagnostics) values ('join_error', jsonb_build_object('provider_code', repeat('x', 2049)));
    raise exception 'Oversized diagnostics accepted';
  exception when check_violation then null; end;
end $$;

-- Model Supabase's API privileges; RLS must still prevent reads/mutations.
grant select, insert, update, delete on site_events to anon;
grant usage, select on sequence site_events_id_seq to anon;
set role anon;
insert into site_events(event, diagnostics) values ('join_error', '{"body_code":"P0001","rpc_reason":"legal_currentness_unavailable","attempt":2}');
do $$ begin
  if exists(select 1 from site_events) then raise exception 'Anonymous read permitted'; end if;
end $$;
update site_events set event = 'page_view';
delete from site_events;
reset role;
do $$ begin
  if (select count(*) from site_events) <> 3 then raise exception 'Anonymous mutation lost events'; end if;
  if exists(select 1 from site_events where event = 'page_view') then raise exception 'Anonymous update permitted'; end if;
end $$;
grant select on site_events to service_role;
set role service_role;
do $$ begin
  if (select count(*) from site_events) <> 3 then raise exception 'Service-role diagnostic read failed'; end if;
end $$;
reset role;

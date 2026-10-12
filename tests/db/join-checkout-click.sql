-- Runs after the diagnostics upgrade and preserves its three historical rows.
do $$ begin
  if (select count(*) from site_events) <> 4 then raise exception 'Upgrade lost history'; end if;
  if (select count(*) from site_events where event = 'join_checkout_click') <> 1 then
    raise exception 'Click did not survive migration reapplication';
  end if;
  begin
    insert into site_events(event) values ('unapproved_event');
    raise exception 'Unknown event accepted';
  exception when check_violation then null; end;
end $$;
set role anon;
insert into site_events(event,page,path) values ('join_checkout_click','join','/join');
insert into site_events(event,page,path) values ('join_checkout_ready','join','/join');
do $$ begin
  if exists(select 1 from site_events) then raise exception 'Anonymous read permitted'; end if;
end $$;
update site_events set event = 'page_view';
delete from site_events;
reset role;
set role service_role;
do $$ begin
  if (select count(*) from site_events) <> 6 then raise exception 'Anonymous mutation lost events'; end if;
  if (select count(*) from site_events where event = 'join_checkout_click') <> 2 then
    raise exception 'Anonymous clicks missing';
  end if;
  if (select count(*) from site_events where event = 'join_checkout_ready') <> 1 then
    raise exception 'Checkout start missing';
  end if;
end $$;
reset role;

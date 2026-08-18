-- Apply before deploying the matching checkout handoff telemetry.
-- Safe to re-run. The random flow_id correlates one submission's lifecycle;
-- it is not derived from member data and is never reused across attempts.

begin;

alter table public.site_events add column if not exists flow_id text;

alter table public.site_events drop constraint if exists site_events_event_check;
alter table public.site_events add constraint site_events_event_check check (
  event in (
    'page_view',
    'deposit_click',
    'deposit_confirmed',
    'form_submit',
    'join_submit',
    'join_checkout_redirect',
    'join_checkout_ready',
    'join_checkout_departed',
    'join_checkout_fallback_clicked',
    'join_checkout_stalled',
    'join_error',
    'membership_checkout_complete',
    'membership_checkout_cancelled',
    'partner_subscription_checkout_submitted',
    'partner_subscription_checkout_cancelled'
  )
);

alter table public.site_events drop constraint if exists site_events_flow_id_check;
alter table public.site_events add constraint site_events_flow_id_check check (
  flow_id is null or flow_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
);

create index if not exists site_events_flow_ts_idx on public.site_events (flow_id, ts desc)
  where flow_id is not null;

commit;

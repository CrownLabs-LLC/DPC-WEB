-- Apply before deploying the diagnostics writer. Additive; existing events
-- and anonymous insert-only/service-role read access remain intact.
begin;
alter table public.site_events add column if not exists diagnostics jsonb;
alter table public.site_events drop constraint if exists site_events_diagnostics_check;
alter table public.site_events add constraint site_events_diagnostics_check check (
  diagnostics is null or (
    jsonb_typeof(diagnostics) = 'object'
    and octet_length(diagnostics::text) <= 2048
    and diagnostics - array[
      'component','stage','failure_kind','outcome','episode_id','request_id',
      'provider_request_id','execution_id','elapsed_ms','attempt','http_status',
      'provider_code','body_code'
    ]::text[] = '{}'::jsonb
  )
);
alter table public.site_events drop constraint if exists site_events_event_check;
alter table public.site_events add constraint site_events_event_check check (
  event in (
    'page_view','deposit_click','deposit_confirmed','form_submit','join_submit',
    'join_checkout_redirect','join_checkout_ready','join_checkout_departed',
    'join_checkout_fallback_clicked','join_checkout_stalled','join_error','join_recovery',
    'membership_checkout_complete','membership_checkout_cancelled',
    'partner_subscription_checkout_submitted','partner_subscription_checkout_cancelled'
  )
);
commit;

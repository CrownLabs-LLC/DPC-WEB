-- Apply before deploying the button-click writer. Checkout start continues to
-- use the existing join_checkout_ready event; no historical rows are rewritten.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
alter table public.site_events drop constraint if exists site_events_event_check;
alter table public.site_events add constraint site_events_event_check check (
  event in (
    'page_view','deposit_click','deposit_confirmed','form_submit','join_submit',
    'join_checkout_click','join_checkout_redirect','join_checkout_ready',
    'join_checkout_departed','join_checkout_fallback_clicked','join_checkout_stalled',
    'join_error','join_recovery','membership_checkout_complete','membership_checkout_cancelled',
    'partner_subscription_checkout_submitted','partner_subscription_checkout_cancelled'
  )
);
notify pgrst, 'reload schema';
commit;

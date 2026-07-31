-- Apply this production prerequisite before deploying the matching web commit.
-- Safe to re-run.

begin;

alter table public.site_events add column if not exists error_code text;
alter table public.site_events add column if not exists http_status integer;

alter table public.site_events drop constraint if exists site_events_event_check;
alter table public.site_events add constraint site_events_event_check check (
  event in (
    'page_view',
    'deposit_click',
    'deposit_confirmed',
    'form_submit',
    'join_submit',
    'join_checkout_redirect',
    'join_error',
    'membership_checkout_complete',
    'membership_checkout_cancelled'
  )
);

alter table public.site_events drop constraint if exists site_events_error_code_check;
alter table public.site_events add constraint site_events_error_code_check check (
  error_code is null or error_code in (
    'turnstile_unavailable',
    'turnstile_incomplete',
    'network',
    'unknown',
    'CHECKOUT_NOT_ENABLED',
    'FOUNDING_UNAVAILABLE',
    'SIGN_IN_REQUIRED',
    'RATE_LIMITED',
    'CHALLENGE_FAILED',
    'LEGAL_VERSIONS_NOT_CURRENT',
    'MEMBER_NOT_ELIGIBLE',
    'DEPOSITOR_CONFIRMATION_INVALID'
  )
);

alter table public.site_events drop constraint if exists site_events_http_status_check;
alter table public.site_events add constraint site_events_http_status_check check (
  http_status is null or http_status between 100 and 599
);

commit;

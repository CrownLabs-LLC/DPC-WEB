-- DPC ops telemetry schema — run once in the Supabase SQL editor
-- (Dashboard -> SQL Editor -> New query -> paste -> Run).
-- Safe to re-run: everything is IF NOT EXISTS / re-created idempotently.

-- Anonymous site funnel events, written by /api/track with the anon key.
-- Contains no identifying data: event name, page label, path, referrer host,
-- and allowlisted join failure code/status.
create table if not exists public.site_events (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  event text not null,
  page text,
  path text,
  referrer text,
  error_code text,
  http_status integer
);

-- CREATE TABLE IF NOT EXISTS does not update an existing production table.
-- Keep these ALTER statements idempotent so this file remains safe to re-run.
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

create index if not exists site_events_event_ts_idx on public.site_events (event, ts desc);
create index if not exists site_events_ts_idx on public.site_events (ts desc);

alter table public.site_events enable row level security;

-- The public anon key may only append events. No select/update/delete
-- policies exist, so the anon key can never read anything back.
drop policy if exists site_events_anon_insert on public.site_events;
create policy site_events_anon_insert on public.site_events
  for insert to anon with check (true);

-- Server-side webhook activity log, written by api/stripe-webhook.js with the
-- service role key (which bypasses RLS). No policies: the anon key has no
-- access at all, in either direction.
create table if not exists public.webhook_logs (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  level text not null,
  source text not null default 'stripe-webhook',
  event_id text,
  session_id text,
  message text not null,
  detail jsonb,
  constraint webhook_logs_level_check check (level in ('info', 'error'))
);

create index if not exists webhook_logs_level_ts_idx on public.webhook_logs (level, ts desc);

alter table public.webhook_logs enable row level security;

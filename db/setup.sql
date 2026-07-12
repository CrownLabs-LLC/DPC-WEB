-- DPC ops telemetry schema — run once in the Supabase SQL editor
-- (Dashboard -> SQL Editor -> New query -> paste -> Run).
-- Safe to re-run: everything is IF NOT EXISTS / re-created idempotently.

-- Anonymous site funnel events, written by /api/track with the anon key.
-- Contains no identifying data: event name, page label, path, referrer host.
create table if not exists public.site_events (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  event text not null,
  page text,
  path text,
  referrer text,
  constraint site_events_event_check
    check (event in ('page_view', 'deposit_click', 'deposit_confirmed', 'form_submit'))
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

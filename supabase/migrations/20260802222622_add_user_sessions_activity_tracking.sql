-- Admin-only visibility into who's using the app, on what device, and
-- whether they've installed it as a PWA / enabled push notifications.
-- Rows are written exclusively by the log-session edge function using the
-- service role (never directly by clients), so the real client IP -- read
-- server-side from the request headers, not supplied by the browser -- can
-- be trusted, and there's deliberately no INSERT policy here at all.
create table public.user_sessions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  user_agent text,
  device_type text,
  os text,
  browser text,
  screen_width int,
  screen_height int,
  is_pwa boolean,
  notification_permission text,
  ip_address text
);

create index user_sessions_profile_occurred_idx on public.user_sessions (profile_id, occurred_at desc);

alter table public.user_sessions enable row level security;

create policy user_sessions_select_admin on public.user_sessions
  for select using (is_admin());

-- One row per profile (including profiles with no session logged yet),
-- carrying their most recent device/session snapshot plus whether they
-- currently have an active push subscription. security_invoker means this
-- runs with the querying user's own RLS, and the `where is_admin()` makes
-- the admin-only intent explicit rather than relying only on the
-- underlying table's policy leaving every joined column null for others.
create view public.user_latest_sessions
  with (security_invoker = true) as
  select
    p.id as profile_id,
    p.full_name,
    p.role,
    ls.occurred_at as last_seen_at,
    ls.user_agent,
    ls.device_type,
    ls.os,
    ls.browser,
    ls.screen_width,
    ls.screen_height,
    ls.is_pwa,
    ls.notification_permission,
    ls.ip_address,
    exists(select 1 from public.push_subscriptions ps where ps.profile_id = p.id) as push_subscribed
  from public.profiles p
  left join lateral (
    select *
    from public.user_sessions s
    where s.profile_id = p.id
    order by s.occurred_at desc
    limit 1
  ) ls on true
  where is_admin();

grant select on public.user_latest_sessions to authenticated;

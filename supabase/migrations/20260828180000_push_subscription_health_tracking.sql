-- Tracks actual delivery health per push subscription, not just "does a
-- row exist" -- every push-sending edge function already prunes a
-- subscription outright on a hard 410/403 (confirmed dead), but any other
-- failure (timeout, 5xx from Apple/Google's push service, network blip)
-- previously just got console.error'd and forgotten -- invisible from the
-- admin side, and the row kept looking perfectly healthy. Prompted by:
-- "any way to know from my admin side that a user is subscribed but their
-- subscription has timed out... so I can tell them to re-subscribe".
alter table public.push_subscriptions
  add column last_success_at timestamptz,
  add column last_failure_at timestamptz,
  add column last_failure_reason text,
  add column consecutive_failures integer not null default 0;

-- push_subs_select was profile_id = auth.uid() only, no admin bypass at
-- all -- found while building this, and worth fixing on its own: it's
-- also what silently made user_device_sessions' push_subscribed column
-- always read false for every profile except whichever one the admin
-- happens to be signed in as, since that view is security_invoker.
alter policy "push_subs_select" on public.push_subscriptions
  using ((profile_id = (select auth.uid())) or is_admin());

-- Atomic increment/reset, called from the service-role edge functions
-- after every send attempt -- a plain UPDATE from JS would need to read
-- consecutive_failures first to add 1, a needless race under concurrent
-- sends to the same endpoint.
create or replace function public.record_push_success(p_endpoint text)
returns void
language sql
security definer
set search_path to 'public'
as $$
  update public.push_subscriptions
  set last_success_at = now(), consecutive_failures = 0
  where endpoint = p_endpoint;
$$;

create or replace function public.record_push_failure(p_endpoint text, p_reason text)
returns void
language sql
security definer
set search_path to 'public'
as $$
  update public.push_subscriptions
  set last_failure_at = now(),
      last_failure_reason = p_reason,
      consecutive_failures = consecutive_failures + 1
  where endpoint = p_endpoint;
$$;

grant execute on function public.record_push_success(text) to service_role;
grant execute on function public.record_push_failure(text, text) to service_role;

-- Admin-only, one row per subscribed device -- deliberately never exposes
-- endpoint/p256dh/auth_key (the actual push credentials), same care as
-- user_device_sessions never exposing phone numbers etc. The React side
-- groups this by person; kept per-device here since a person subscribed
-- on two devices with one healthy and one failing is exactly the case
-- worth being able to tell apart.
create view public.push_subscription_health
  with (security_invoker = true) as
  select
    ps.id,
    ps.profile_id,
    p.full_name,
    p.role,
    ps.user_agent,
    ps.created_at as subscribed_at,
    ps.last_success_at,
    ps.last_failure_at,
    ps.last_failure_reason,
    ps.consecutive_failures
  from public.push_subscriptions ps
  join public.profiles p on p.id = ps.profile_id
  where is_admin();

grant select on public.push_subscription_health to authenticated;

-- A person can use several distinct device/browser combos (phone PWA,
-- phone browser tab, laptop Chrome, ...) that all share the same profile.
-- The original user_latest_sessions view collapsed everything down to a
-- single most-recent row per profile, which hid whichever device wasn't
-- used last -- e.g. it could show "notifications: off" for someone who
-- has them on on their phone but happened to open the desktop site more
-- recently. Replaced with one row per (profile, user_agent, is_pwa),
-- since the same browser installed as a PWA vs opened as a normal tab
-- typically reports an identical user_agent -- is_pwa has to be part of
-- the identity key too, or those two would incorrectly collapse together.
drop view public.user_latest_sessions;

create view public.user_devices
  with (security_invoker = true) as
  select distinct on (profile_id, user_agent, is_pwa)
    *
  from public.user_sessions
  order by profile_id, user_agent, is_pwa, occurred_at desc;

create view public.user_device_sessions
  with (security_invoker = true) as
  select
    p.id as profile_id,
    p.full_name,
    p.role,
    d.occurred_at as last_seen_at,
    d.user_agent,
    d.device_type,
    d.os,
    d.browser,
    d.screen_width,
    d.screen_height,
    d.is_pwa,
    d.notification_permission,
    d.ip_address,
    exists(select 1 from public.push_subscriptions ps where ps.profile_id = p.id) as push_subscribed
  from public.profiles p
  left join public.user_devices d on d.profile_id = p.id
  where is_admin();

grant select on public.user_device_sessions to authenticated;

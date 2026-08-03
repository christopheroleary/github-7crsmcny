-- Admin doesn't want their own usage collected or shown here at all --
-- excluded at the view level (not just left uncollected client-side) so
-- an admin account never appears in this dashboard even if a row somehow
-- existed.
create or replace view public.user_device_sessions
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
  where is_admin() and p.role <> 'admin';

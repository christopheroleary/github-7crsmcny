-- user_device_sessions (security_invoker) selects directly from this view
-- in its FROM clause, so the querying role needs its own grant here too --
-- same requirement already hit once for user_sessions itself.
grant select on public.user_devices to authenticated;

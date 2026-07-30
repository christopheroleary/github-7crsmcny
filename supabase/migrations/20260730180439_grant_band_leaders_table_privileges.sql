-- New tables don't automatically inherit the project's default privilege
-- grants the way pre-existing tables do. Without this, authenticated
-- requests hit "permission denied for table band_leaders" before RLS is
-- even evaluated.
grant select, insert, update, delete on public.band_leaders to authenticated;
grant select on public.band_leaders to service_role;

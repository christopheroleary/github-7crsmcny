-- service_role was missing a plain SELECT grant on this table (a lower
-- layer than RLS -- service_role bypasses RLS but still needs the grant
-- to touch the table at all). Root cause of dep names showing as "A
-- musician" in admin notifications: notify-admin's service-role client
-- silently got "permission denied" on every placeholder_musicians lookup
-- (the error was never checked), so it always fell through to the
-- generic fallback. The frontend app was unaffected since it queries as
-- the authenticated role, which already had SELECT here.
grant select on public.placeholder_musicians to service_role;

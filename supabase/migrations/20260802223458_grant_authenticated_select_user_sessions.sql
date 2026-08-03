-- The user_latest_sessions view's security_invoker=true means it runs with
-- the querying role's own table-level grants, not just RLS -- without
-- this, even an admin's own SELECT through the view was rejected before
-- RLS ever got a chance to run. RLS (admin-only, from the previous
-- migration) still does the actual per-row gating on top of this.
grant select on public.user_sessions to authenticated;

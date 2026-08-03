-- service_role bypasses RLS but still needs an explicit table-level grant
-- to touch a newly created table at all (RLS only ever narrows rows on
-- top of an already-permitted query, it doesn't grant access by itself).
-- Without this, the log-session edge function's insert (using the service
-- role key) failed with "permission denied for table user_sessions".
grant select, insert on public.user_sessions to service_role;

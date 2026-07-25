-- service_role (used by edge functions via SUPABASE_SERVICE_ROLE_KEY) had zero
-- privileges on this table, so every push-notification send silently found
-- "no subscriptions" (supabase-js swallows the permission-denied error and the
-- calling code falls back to an empty array) even though rows existed.
grant select, delete on public.push_subscriptions to service_role;

-- Missed by 20260827100000_harden_function_execute_grants.sql since this
-- trigger function didn't exist yet -- same accidental-PUBLIC-EXECUTE gap
-- on the same class of function (trigger-only, fires under its own
-- privileges regardless of grants, never called via supabase.rpc(...)
-- anywhere in src/), closed the same way.
revoke execute on function public.protect_band_connect_fields() from public;

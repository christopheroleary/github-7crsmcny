-- Same accidental-PUBLIC-EXECUTE default every new Postgres function gets
-- unless explicitly revoked -- get_payment_details (its profiles-level
-- counterpart) got this closed in 20260827100000_harden_function_execute_grants.sql,
-- this one just missed the same treatment since it didn't exist yet.
-- Genuinely authenticated-only: unlike get_invoice_by_token and friends,
-- there's no public share-link use case for a band's own bank details.
revoke execute on function public.get_band_payment_details(uuid) from public;

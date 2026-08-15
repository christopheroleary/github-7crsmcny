-- Missed when subscription_tier/stripe_customer_id/stripe_subscription_id
-- were added: this project grants UPDATE per-column to service_role rather
-- than table-wide (see stripe_connect_account_id/stripe_connect_status in
-- grant_service_role_stripe_payment_tables), and these three were never
-- added -- caused "permission denied for table profiles" (42501) in
-- stripe-webhook when a real subscription checkout completed.
grant update (subscription_tier, stripe_customer_id, stripe_subscription_id) on public.profiles to service_role;

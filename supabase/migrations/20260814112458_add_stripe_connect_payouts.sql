-- Phase 2 of Stripe integration: paying musicians out via Connect instead of
-- manual bank transfer. See connect-recommend-plan.md at the project root
-- for the full architecture writeup -- short version: Express dashboard,
-- recipient accounts, separate charges and transfers (a musician's payout
-- isn't tied to any single client charge, it's released whenever an admin
-- approves their claim).

-- Musicians only -- placeholder/dep musicians have no login or verified
-- identity, which Connect requires, so they permanently stay on the
-- existing manual bank-transfer flow (see ProfilePaymentDetails.jsx).
alter table public.profiles
  add column stripe_connect_account_id text unique,
  add column stripe_connect_status text; -- null (not started) | 'pending' | 'active' | 'restricted'
  -- Kept in sync by the stripe-connect-webhook Edge Function reacting to
  -- account.updated, rather than checked live against the Stripe API on
  -- every claims-admin page load. 'active' is the only status that gates
  -- a real payout -- see the capability check in create-connect-transfer.

comment on column public.profiles.stripe_connect_status is
  'Cached from Stripe account.updated webhook events. active = stripe_transfers capability is live and payouts can be sent. Anything else falls back to the existing manual bank-transfer flow.';

-- Traceability for a claim paid via Stripe, same reasoning as
-- invoice_payments.stripe_payment_intent_id: lets the admin UI show a
-- "paid via Stripe" indicator and gives a concrete Stripe object to look
-- up if a payout needs investigating.
alter table public.musician_claims
  add column stripe_transfer_id text unique;

-- service_role has NO table-level grants at all on profiles or
-- musician_claims (same systemic gap as invoices before
-- 20260814095336_grant_service_role_stripe_payment_tables.sql -- this
-- project's tables simply never grant service_role anything by default,
-- RLS bypass or not). The account-creation, payout, and webhook Edge
-- Functions need to read broadly (musician name/id for account creation,
-- claim + gig context for computing a payout amount) but should only ever
-- *write* the specific columns they own -- full SELECT, narrow UPDATE.
grant select on public.profiles to service_role;
grant update (stripe_connect_account_id, stripe_connect_status) on public.profiles to service_role;
grant select on public.musician_claims to service_role;
grant update (status, stripe_transfer_id) on public.musician_claims to service_role;

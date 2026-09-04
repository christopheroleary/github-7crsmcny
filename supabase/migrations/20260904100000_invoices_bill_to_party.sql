-- Lets an invoice bill the gig's client (today's only option, unchanged
-- default), the gig's venue (a pub band whose "client" is really the
-- venue), or another band in the system (an agency/headline act
-- represented as its own band row) -- without duplicating that party's
-- name/contact/address into a 4th place.
--
-- All-null (every existing row, today) means "fall back to gigs.client_id"
-- -- exactly today's behaviour, zero regression, no backfill needed. This
-- is deliberately NOT a strict XOR (which would force exactly one) since
-- every existing invoice must stay valid with all three unset -- num_nonnulls
-- is the right tool for "0 or 1, never 2+", vs. the hand-written OR-of-ANDs
-- musician_claims_claimant_check uses for a strict 2-way XOR that must
-- never be all-null.
alter table public.invoices
  add column bill_to_client_id uuid references public.clients(id) on delete set null,
  add column bill_to_venue_id  uuid references public.venues(id)  on delete set null,
  add column bill_to_band_id   uuid references public.bands(id)   on delete set null;

alter table public.invoices
  add constraint invoices_bill_to_at_most_one
  check (num_nonnulls(bill_to_client_id, bill_to_venue_id, bill_to_band_id) <= 1);

comment on column public.invoices.bill_to_client_id is
  'Explicit bill-to override: an existing clients row. NULL (with the other two) falls back to gigs.client_id.';
comment on column public.invoices.bill_to_venue_id is
  'Explicit bill-to override: the gig''s own venue (or any venue) as the billing party, e.g. a pub band billing the venue directly.';
comment on column public.invoices.bill_to_band_id is
  'Explicit bill-to override: another band in the system as the billing party, e.g. a subcontracted act billing an agency represented as its own band.';

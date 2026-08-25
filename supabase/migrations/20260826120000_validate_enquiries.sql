-- Length caps and validation on public.enquiries.
--
-- This is the only table in the app an unauthenticated stranger can write
-- to, and every text column was unbounded. Escaping the print templates
-- stopped a crafted enquiry from EXECUTING anywhere, but it didn't stop
-- someone submitting a megabyte of text per field, or a "client name"
-- padded out to look like part of the admin UI. Constraints live here
-- rather than only in EnquiryForm.jsx because the form is not the boundary
-- -- anyone can POST straight at PostgREST with the anon key.
--
-- All limits verified against the 6 existing rows before being applied;
-- none of them come close.

alter table public.enquiries
  -- btrim so a name of pure whitespace can't satisfy "not empty".
  add constraint enquiries_client_name_len
    check (length(btrim(client_name)) between 1 and 100),

  -- Deliberately permissive: "something@something.something" with no
  -- spaces. Stops the field being used as a text dump without trying to
  -- out-clever RFC 5322, which rejects real addresses far more often than
  -- it catches bad ones.
  add constraint enquiries_client_email_valid
    check (client_email is null or (
      length(client_email) <= 200
      and client_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    )),

  add constraint enquiries_client_phone_len
    check (client_phone is null or length(client_phone) <= 40),

  add constraint enquiries_venue_name_len
    check (venue_name is null or length(venue_name) <= 200),

  add constraint enquiries_venue_address_len
    check (venue_address is null or length(venue_address) <= 300),

  add constraint enquiries_requirements_len
    check (requirements is null or length(requirements) <= 2000),

  -- admin_notes is admin-written, but capped for the same storage reason.
  add constraint enquiries_admin_notes_len
    check (admin_notes is null or length(admin_notes) <= 5000),

  -- event_type and band_size are <select> fields with fixed options, so a
  -- whitelist is tighter than a length cap and matches how
  -- expenses.category is already handled. Keep in sync with the options in
  -- src/components/EnquiryForm.jsx.
  add constraint enquiries_event_type_valid
    check (event_type is null or event_type in (
      'Wedding', 'Corporate event', 'Birthday party', 'Anniversary',
      'Festival / outdoor', 'Private party', 'Other'
    )),

  add constraint enquiries_band_size_valid
    check (band_size is null or band_size in (
      'Solo / duo', '3 piece', '4 piece', '5 piece', '6+ piece'
    )),

  add constraint enquiries_budget_range
    check (estimated_budget is null or estimated_budget between 0 and 10000000),

  -- Static bounds rather than anything relative to today: a CHECK can only
  -- use immutable expressions, so now() isn't available here. This won't
  -- catch "next century" as a typo, but it does stop year 99999 nonsense
  -- breaking date rendering downstream.
  add constraint enquiries_event_date_sane
    check (event_date is null or event_date between date '2000-01-01' and date '2100-01-01');

-- A cosmetic/UX-only flag: never read by RLS, a trigger, or feeSplit.js.
-- It exists purely so BandForm.jsx/GigForm.jsx can hide/zero the
-- multi-person-only fee-split fields (captain/singer/DJ/roadie bonus %)
-- for a solo DJ or solo singer who is the band's only member -- the
-- underlying band/gig/fee-split/claims machinery already works correctly
-- for a one-person band with no changes needed there.
alter table public.bands
  add column is_solo boolean not null default false;

comment on column public.bands.is_solo is
  'UI-only flag for a solo act (DJ / solo singer, no other musicians). Not read by RLS or fee-split math -- purely drives which BandForm fields are shown.';

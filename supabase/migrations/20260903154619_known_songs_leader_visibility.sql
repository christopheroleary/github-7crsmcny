-- known_songs_select was self-or-admin only, which silently broke every
-- existing plain client-side query a non-admin band leader ran against
-- another musician's known_songs (e.g. DepFinderWizard.jsx) -- a
-- pre-existing gap, not something introduced by the feature that
-- surfaced it. Reuse the existing can_view_profile() helper (self,
-- dep-pool opt-in, band-mate-of-a-band-you-lead, gig-mate-of-a-gig-you-
-- lead, peer-sharing-a-gig/band) rather than writing a bespoke predicate.
alter policy "known_songs_select" on public.known_songs
using (
  (profile_id = (select auth.uid()))
  or (select is_admin())
  or can_view_profile(profile_id)
);

-- The musician-side UPDATE policy only allowed touching a claim while its
-- CURRENT status was 'pending'. Resubmitting a rejected claim updates a row
-- whose current status is 'rejected', so RLS silently matched zero rows —
-- no error, but the amended fee/description never saved and the admin was
-- never re-notified (the notify-admin trigger only fires on an actual UPDATE).
drop policy if exists claims_update on public.musician_claims;

create policy claims_update on public.musician_claims
  for update
  using ( (profile_id = auth.uid() and status in ('pending', 'rejected')) or is_admin() )
  with check ( (profile_id = auth.uid() and status = 'pending') or is_admin() );

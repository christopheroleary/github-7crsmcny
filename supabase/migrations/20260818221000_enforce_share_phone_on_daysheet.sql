-- SECURITY FIX: share_phone_on_daysheet was a UI-only promise.
--
-- The toggle in MyProfile tells a musician their number will not be shared
-- with bandmates, but it was only ever checked in a React render condition
-- (GigDetailBandMember.jsx). The underlying roster query in
-- useOfflineGigData.js selected profiles(... phone ...) unconditionally for
-- every lineup member, so the number was fetched over the wire, held in
-- component state, and written to the offline localStorage cache regardless
-- of the setting -- readable by anyone with dev tools or the device, for
-- people who had explicitly opted out.
--
-- This function is the data-layer replacement: it returns numbers only for
-- lineup members who actually opted in, and only to someone entitled to the
-- gig in the first place (on the lineup, leading the band, or admin). The
-- frontend drops `phone` from its profiles embed and calls this instead, so
-- an opted-out number is never sent to the client at all.
--
-- Note this hardens the roster path specifically. A member could still read
-- a gig-mate's phone by querying public.profiles directly, since RLS is
-- row-level and cannot mask a single column. Closing that fully needs
-- column-level privileges (revoke select (phone) ... ) plus an RPC for
-- reading your own profile; that is a larger change across the four call
-- sites that select phone today and wants testing against a live database,
-- so it is deliberately sequenced after this.

create or replace function public.get_gig_roster_phones(p_gig_id uuid)
returns table (profile_id uuid, phone text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select p.id, p.phone
  from public.gig_lineup gl
  join public.profiles p on p.id = gl.profile_id
  where gl.gig_id = p_gig_id
    -- Only numbers whose owner opted in.
    and p.share_phone_on_daysheet = true
    and p.phone is not null
    -- And only for a caller entitled to this gig. Mirrors gigs_select.
    and (
      public.is_admin()
      or public.is_on_gig(p_gig_id)
      or exists (
        select 1 from public.gigs g
        where g.id = p_gig_id and g.band_id is not null and public.is_band_leader_of(g.band_id)
      )
    );
$$;

-- Signed-in users only: there is no public/day-sheet-by-token path here.
revoke execute on function public.get_gig_roster_phones(uuid) from anon;
grant execute on function public.get_gig_roster_phones(uuid) to authenticated;

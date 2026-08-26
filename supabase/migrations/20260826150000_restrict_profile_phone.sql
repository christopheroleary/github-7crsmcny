-- Closes the same gap as the bank-details fix, for phone.
--
-- profiles.phone was left in the blanket column grant deliberately when
-- bank details were locked down, because unlike bank details it has real
-- peer-visibility use cases (rosters, day sheets). But it was left
-- readable to EVERY row can_view_profile() allows -- which is any
-- gig-mate or band-mate, unconditionally. That made
-- share_phone_on_daysheet cosmetic for three call sites that read the
-- column directly (MyProfile's own load, MusiciansList, DepFinderWizard,
-- GigWhatsAppGroup), exactly the bug get_gig_roster_phones was written to
-- avoid for the day sheet specifically -- the fix just hadn't been applied
-- everywhere phone was read.
--
-- The day-sheet path (get_gig_roster_phones, useOfflineGigData.js) already
-- respects share_phone_on_daysheet and is untouched by this migration --
-- it's the correct model for ordinary roster-mates seeing each other's
-- number.
--
-- What this migration actually restricts is the OTHER path: management
-- actions (admin's musician list, a band leader finding a dep, an
-- admin/leader building a WhatsApp group for a gig) that legitimately
-- need the real number regardless of the day-sheet opt-in. Those stay
-- working, scoped to admin or any band leader -- deliberately not scoped
-- to "leader of this specific band", matching the existing precedent in
-- can_view_profile()'s dep-pool clause, which grants the same blanket
-- band-leader access today.
revoke select (phone) on public.profiles from authenticated;

create or replace function public.get_profile_phones(p_profile_ids uuid[])
returns table (id uuid, phone text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select p.id, p.phone
  from public.profiles p
  where p.id = any(p_profile_ids)
    and (p.id = auth.uid() or public.is_admin() or public.is_band_leader());
$function$;

grant execute on function public.get_profile_phones(uuid[]) to authenticated;

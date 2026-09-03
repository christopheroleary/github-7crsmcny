-- merge_placeholder_musician already repoints gig_lineup, gig_whatsapp_
-- invites, profile_instruments, known_songs and band_members from the
-- placeholder to the newly-linked real account -- it just predates
-- musician_claims.placeholder_id (added the day before this migration),
-- so a claim raised for a dep who later signs up and gets merged was
-- silently orphaned: left keyed to the now-merged placeholder, invisible
-- in the musician's own "My payment claim" self-view (which only ever
-- looks up their own profile_id), and unmatched by the admin view's
-- roster-vs-claimed comparison once gig_lineup's own row already moved to
-- profile_id.
--
-- Deliberately NOT mirroring band_members' delete-on-duplicate guard here:
-- a band_members row is pure membership (redundant duplicates carry no
-- information), but a claim carries real content -- specific line items,
-- an attached invoice. Silently deleting one because the target profile
-- already happens to have another claim on the same gig risks destroying
-- a genuine, distinct financial record. If a real duplicate ever results,
-- the leader can already reject/delete it by hand the same way as any
-- other claim -- better than this function guessing which one to keep.
create or replace function public.merge_placeholder_musician(p_placeholder_id uuid, p_target_profile_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then
    raise exception 'Only admins can merge placeholder musicians';
  end if;

  update public.gig_lineup
    set profile_id = p_target_profile_id, placeholder_id = null
    where placeholder_id = p_placeholder_id;

  update public.gig_whatsapp_invites
    set profile_id = p_target_profile_id, placeholder_id = null
    where placeholder_id = p_placeholder_id;

  update public.musician_claims
    set profile_id = p_target_profile_id, placeholder_id = null
    where placeholder_id = p_placeholder_id;

  insert into public.profile_instruments (profile_id, instrument_id)
    select p_target_profile_id, pmi.instrument_id
    from public.placeholder_musician_instruments pmi
    where pmi.placeholder_id = p_placeholder_id
    on conflict (profile_id, instrument_id) do nothing;

  insert into public.known_songs (profile_id, song_id, can_sing_lead)
    select p_target_profile_id, pks.song_id, pks.can_sing_lead
    from public.placeholder_known_songs pks
    where pks.placeholder_id = p_placeholder_id
    on conflict (profile_id, song_id) do nothing;

  delete from public.band_members bm
    where bm.placeholder_id = p_placeholder_id
      and exists (
        select 1 from public.band_members bm2
        where bm2.band_id = bm.band_id and bm2.profile_id = p_target_profile_id
      );

  update public.band_members
    set profile_id = p_target_profile_id, placeholder_id = null
    where placeholder_id = p_placeholder_id;

  update public.placeholder_musicians
    set merged_into = p_target_profile_id
    where id = p_placeholder_id;
end;
$function$;

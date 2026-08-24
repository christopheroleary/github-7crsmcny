-- The merge repointed gig_lineup and profile_instruments but never touched
-- band_members, placeholder_known_songs, or gig_whatsapp_invites -- so a dep
-- who'd been added as a persistent band member (not just booked gig-by-gig)
-- silently dropped off that band's member list once merged, their known
-- songs vanished from the shared repertoire view, and their WhatsApp invite
-- history stopped showing against the real account.
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

  -- If the target is already a member of that band, repointing would create
  -- a straight duplicate row rather than new information -- drop the dep's
  -- row instead. Otherwise carry the membership across so it doesn't just
  -- disappear (band_members_placeholder_id_fkey is ON DELETE CASCADE, so
  -- leaving this unhandled would silently drop it once the placeholder is
  -- ever deleted).
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

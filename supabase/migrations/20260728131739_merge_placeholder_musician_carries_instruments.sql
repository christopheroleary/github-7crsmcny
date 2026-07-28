-- The merge only repointed gig_lineup rows and marked the placeholder as
-- merged. It never carried the dep's known instruments (placeholder_musician_instruments)
-- over to the new profile's own instrument list (profile_instruments), so a
-- merged musician's instrument capability vanished from their profile going
-- forward (future gig-add forms couldn't pre-select their instrument).
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

  insert into public.profile_instruments (profile_id, instrument_id)
    select p_target_profile_id, pmi.instrument_id
    from public.placeholder_musician_instruments pmi
    where pmi.placeholder_id = p_placeholder_id
    on conflict (profile_id, instrument_id) do nothing;

  update public.placeholder_musicians
    set merged_into = p_target_profile_id
    where id = p_placeholder_id;
end;
$function$;

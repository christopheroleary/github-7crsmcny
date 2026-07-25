-- Require admin privileges to merge a placeholder musician into a real profile.
-- Previously this SECURITY DEFINER function had no authorization check at all,
-- letting any signed-in user reassign gig lineup slots for anyone.
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
  update public.placeholder_musicians
    set merged_into = p_target_profile_id
    where id = p_placeholder_id;
end;
$function$;

-- Remove the unrestricted anon/authenticated INSERT policy on notifications.
-- No client code or SQL function inserts into this table; legitimate inserts
-- come from edge functions using the service_role key, which bypasses RLS
-- entirely and is unaffected by removing this policy.
drop policy if exists notifications_insert_service on public.notifications;

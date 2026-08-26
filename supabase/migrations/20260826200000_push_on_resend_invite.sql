-- resend_gig_invite() previously only wrote a bell notification, no push --
-- undercutting the point of a manual "get their attention now" nudge for
-- someone who isn't currently in the app. Swaps the direct insert for the
-- same webhook call gig_lineup INSERT already uses, so notify-musician
-- handles both the bell row and push together (new 'RESEND' type, handled
-- in notify-musician/index.ts). No apikey header needed -- notify-musician
-- has verify_jwt disabled, same as its other trigger-fired callers.
create or replace function public.resend_gig_invite(p_lineup_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_gig_id uuid;
  v_band_id uuid;
  v_profile_id uuid;
begin
  select gl.gig_id, gl.profile_id, g.band_id
    into v_gig_id, v_profile_id, v_band_id
  from public.gig_lineup gl
  join public.gigs g on g.id = gl.gig_id
  where gl.id = p_lineup_id;

  if v_gig_id is null then
    raise exception 'Roster row not found';
  end if;
  if v_profile_id is null then
    raise exception 'This roster row has no real account to notify (dep/placeholder)';
  end if;
  if not (public.is_admin() or public.is_band_leader_of(v_band_id)) then
    raise exception 'Not authorised to resend this invite';
  end if;

  update public.gig_lineup
    set created_at = now(), admin_notified_at = null
    where id = p_lineup_id;

  perform net.http_post(
    'https://uzblypxepztdramotjcc.supabase.co/functions/v1/notify-musician',
    jsonb_build_object(
      'type', 'RESEND',
      'table', 'gig_lineup',
      'record', jsonb_build_object('id', p_lineup_id, 'profile_id', v_profile_id, 'gig_id', v_gig_id)
    ),
    '{}'::jsonb,
    '{"Content-type":"application/json"}'::jsonb,
    5000
  );
end;
$function$;

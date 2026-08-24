-- Tracks when a real musician was added to a gig's roster, so the admin/
-- band-leader view can show "added <date>" and count down to a reminder if
-- they still haven't confirmed. gig_lineup never had a created_at column at
-- all -- existing rows backfill to the migration's run time (their true
-- original add date was never recorded), new rows get their real add time
-- going forward.
alter table public.gig_lineup
  add column created_at timestamptz not null default now(),
  add column admin_notified_at timestamptz;

-- Lets an admin/band-leader manually re-send the "please confirm" nudge to
-- a musician who hasn't responded, from the roster row itself rather than
-- waiting for the 2-day auto-reminder. Also restarts the countdown/dedupe
-- clock (created_at, admin_notified_at) exactly as if they'd just been
-- added -- a resend is, in effect, inviting them again.
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
  v_venue_name text;
  v_gig_date date;
begin
  select gl.gig_id, gl.profile_id, g.band_id, g.gig_date, v.name
    into v_gig_id, v_profile_id, v_band_id, v_gig_date, v_venue_name
  from public.gig_lineup gl
  join public.gigs g on g.id = gl.gig_id
  left join public.venues v on v.id = g.venue_id
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

  insert into public.notifications (profile_id, title, body, url, gig_id, section)
  values (
    v_profile_id,
    'Reminder: please confirm your gig',
    coalesce(v_venue_name, 'A gig') || ' on ' || to_char(v_gig_date, 'DD Mon YYYY') || ' — tap to confirm you can make it.',
    '/gigs',
    v_gig_id,
    'roster'
  );

  update public.gig_lineup
    set created_at = now(), admin_notified_at = null
    where id = p_lineup_id;
end;
$function$;

grant execute on function public.resend_gig_invite(uuid) to authenticated;

-- A musician could have their fee cut after confirming a gig, with no way
-- to know unless they happened to reread the gig page -- a genuine
-- trust/morale risk (band-leader edits fee down post-agreement, musician
-- finds out at payout). This adds:
--   1. confirmed_fee_pence: a snapshot of what the musician actually
--      agreed to, taken the moment `confirmed` flips true (and reset on
--      re-confirm after being unconfirmed).
--   2. A notification the instant fee_pence drops below that snapshot
--      while still confirmed, so they find out promptly instead of at
--      payout.
-- A visible flag in the UI (GigRoster.jsx for admin, GigDetailBandMember.jsx
-- for the musician) is added separately so the discrepancy stays visible
-- even if the notification goes unread.

alter table public.gig_lineup add column confirmed_fee_pence integer;

-- Existing confirmed rows: treat their current fee as the agreed baseline
-- going forward, rather than flagging every historical fee as "reduced".
update public.gig_lineup set confirmed_fee_pence = fee_pence where confirmed = true;

create or replace function public.snapshot_confirmed_fee()
returns trigger
language plpgsql
as $function$
begin
  if new.confirmed = true and (tg_op = 'INSERT' or coalesce(old.confirmed, false) = false) then
    new.confirmed_fee_pence := new.fee_pence;
  elsif new.confirmed = false then
    new.confirmed_fee_pence := null;
  end if;
  return new;
end;
$function$;

drop trigger if exists gig_lineup_snapshot_confirmed_fee on public.gig_lineup;
create trigger gig_lineup_snapshot_confirmed_fee
  before insert or update on public.gig_lineup
  for each row execute function public.snapshot_confirmed_fee();

-- security definer, owned by postgres (bypassrls) -- same pattern as
-- merge_placeholder_musician -- since notifications intentionally has no
-- client-side insert policy; all inserts come from trusted server-side code.
create or replace function public.notify_fee_decrease()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  venue_name text;
begin
  if old.confirmed = true and new.confirmed = true
     and new.fee_pence is distinct from old.fee_pence
     and old.confirmed_fee_pence is not null
     and new.fee_pence < old.confirmed_fee_pence
     and new.profile_id is not null then

    select v.name into venue_name
    from public.gigs g left join public.venues v on v.id = g.venue_id
    where g.id = new.gig_id;

    insert into public.notifications (profile_id, title, body, url, gig_id, section)
    values (
      new.profile_id,
      'Your fee was reduced',
      'Your fee for ' || coalesce(venue_name, 'a gig') || ' was reduced from £'
        || to_char(old.confirmed_fee_pence / 100.0, 'FM999999990.00') || ' to £'
        || to_char(new.fee_pence / 100.0, 'FM999999990.00') || ' after you confirmed.',
      '/gigs',
      new.gig_id,
      'roster'
    );
  end if;
  return new;
end;
$function$;

drop trigger if exists gig_lineup_notify_fee_decrease on public.gig_lineup;
create trigger gig_lineup_notify_fee_decrease
  after update on public.gig_lineup
  for each row execute function public.notify_fee_decrease();

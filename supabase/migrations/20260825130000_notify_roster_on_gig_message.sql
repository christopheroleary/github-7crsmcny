-- Gig chat previously sent no notifications at all (deliberately, per the
-- old hint text in GigMessages.jsx) -- but that meant a message asking
-- "can everyone confirm parking?" the night before a gig could sit unread
-- until someone happened to reopen it. Notifies everyone else on the gig's
-- real-account roster (not the sender, not placeholders/deps who have no
-- login) when a new message lands, same insert-into-notifications pattern
-- as notify_fee_decrease/notify_admins_of_feedback.
create or replace function public.notify_gig_message()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  venue_name text;
  sender_name text;
  gig_label text;
  recipient_id uuid;
begin
  select v.name, p.full_name
    into venue_name, sender_name
  from public.gigs g
  left join public.venues v on v.id = g.venue_id
  left join public.profiles p on p.id = new.sender_id
  where g.id = new.gig_id;

  gig_label := coalesce(venue_name, 'the gig');

  for recipient_id in
    select distinct gl.profile_id
    from public.gig_lineup gl
    where gl.gig_id = new.gig_id
      and gl.profile_id is not null
      and gl.profile_id != new.sender_id
  loop
    insert into public.notifications (profile_id, title, body, url, gig_id, section)
    values (
      recipient_id,
      coalesce(sender_name, 'Someone') || ' messaged about ' || gig_label,
      new.body,
      '/gigs',
      new.gig_id,
      'chat'
    );
  end loop;

  return new;
end;
$function$;

create trigger gig_messages_notify_roster
  after insert on public.gig_messages
  for each row execute function public.notify_gig_message();

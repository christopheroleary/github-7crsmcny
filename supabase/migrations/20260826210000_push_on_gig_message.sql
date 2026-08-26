-- notify_gig_message() previously looped over the roster and wrote a bell
-- row per recipient directly, with no push at all -- the exact problem this
-- feature was built to solve ("can everyone confirm parking?" sitting
-- unread) only got half-fixed. Swaps the direct insert loop for a single
-- webhook call to notify-musician (new gig_messages/INSERT case, handled in
-- notify-musician/index.ts), which now does the roster lookup itself and
-- sends bell + push together per recipient. No apikey header needed --
-- notify-musician has verify_jwt disabled, same as its other trigger-fired
-- callers.
create or replace function public.notify_gig_message()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform net.http_post(
    'https://uzblypxepztdramotjcc.supabase.co/functions/v1/notify-musician',
    jsonb_build_object('type', 'INSERT', 'table', 'gig_messages', 'record', to_jsonb(new)),
    '{}'::jsonb,
    '{"Content-type":"application/json"}'::jsonb,
    5000
  );
  return new;
end;
$function$;

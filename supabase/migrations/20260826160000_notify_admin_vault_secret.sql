-- Replaces the leaked literal service_role key in the enquiry/signup
-- notify-admin triggers with a Vault lookup, done at call time.
--
-- The previous version used supabase_functions.http_request(), Supabase's
-- generic webhook-trigger shorthand -- but its arguments (including the
-- auth header) are baked into the trigger definition as static text at
-- CREATE TRIGGER time, not re-evaluated per row. That's exactly why the
-- key ended up hardcoded in the migration in the first place: there was
-- no way to hand it a "look this up fresh each time" reference. Vault
-- access has to happen inside a real function body instead, so this
-- defines one and calls net.http_post() directly -- the same underlying
-- call supabase_functions.http_request() was making anyway (confirmed by
-- reading its source: same jsonb_build_object(...) payload shape this
-- reproduces, same net.http_post(url, payload, params, headers,
-- timeout_ms) call).
--
-- Sent as an "apikey" header rather than "Authorization: Bearer" --
-- matches Supabase's own guidance for calling an Edge Function with a
-- new-style secret key from a database trigger. Notably, the ORIGINAL
-- migration's header was malformed anyway (a literal key named
-- "Authorization: Bearer" is not how HTTP headers work) and notify-admin's
-- own code never checked any Authorization header to begin with -- this
-- request was never actually authenticated by anything, leaked key or
-- not. Sending a real apikey now is a genuine improvement, not just a
-- like-for-like swap.
create or replace function public.notify_admin_webhook()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  api_key text;
  payload jsonb;
begin
  select decrypted_secret into api_key
  from vault.decrypted_secrets
  where name = 'notify_admin_trigger_key';

  if api_key is null then
    -- Fail open, not closed: a misconfigured secret should never block
    -- the enquiry/signup insert itself from succeeding. Logged so it's
    -- visible in the function's own logs rather than silently no-op'd.
    raise warning 'notify_admin_webhook: notify_admin_trigger_key not found in Vault, skipping';
    return new;
  end if;

  payload := jsonb_build_object(
    'old_record', old,
    'record', new,
    'type', tg_op,
    'table', tg_table_name,
    'schema', tg_table_schema
  );

  perform net.http_post(
    'https://uzblypxepztdramotjcc.supabase.co/functions/v1/notify-admin',
    payload,
    '{}'::jsonb,
    jsonb_build_object('Content-Type', 'application/json', 'apikey', api_key),
    5000
  );

  return new;
end;
$function$;

drop trigger if exists "notify-admin-enquiry" on public.enquiries;
create trigger notify_admin_enquiry
  after insert on public.enquiries
  for each row execute function public.notify_admin_webhook();

drop trigger if exists "notify-admin-signup" on public.profiles;
create trigger notify_admin_signup
  after insert on public.profiles
  for each row execute function public.notify_admin_webhook();

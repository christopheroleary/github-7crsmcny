-- Four pg_cron jobs were still sending the legacy anon key as their apikey
-- header. Much lower severity than the service_role leak fixed earlier
-- today -- the anon key is meant to be public, client-exposed, safe to sit
-- in a migration (see the comment this file's gig-day-reminder job
-- originally shipped with) -- but it's still the LEGACY key, and legacy
-- keys are being retired. Left as-is, these four jobs would all start
-- failing the moment legacy keys are disabled.
--
-- Re-points each at the new sb_publishable_... key. Unschedule-then-
-- reschedule rather than relying on cron.schedule()'s upsert-by-name
-- behaviour, to make the replacement explicit rather than assumed.
--
-- Also fixes a real, separately-discovered bug while here: nearby-places-
-- sweep calls refresh-venue-nearby-places, which has verify_jwt = true --
-- but this job only ever sent an apikey header, never an Authorization
-- bearer token, so Supabase's gateway has been rejecting every single
-- sweep with 401 "Missing authorization header" since the day it was
-- scheduled (confirmed live in net._http_response: consistent 401s every
-- 10 minutes). The other three jobs call verify_jwt=false functions, so
-- apikey-only was always sufficient for them. Rather than guess whether a
-- new-style secret key would satisfy JWT verification at the gateway
-- (undocumented), refresh-venue-nearby-places is switched to
-- verify_jwt=false to match its three cron siblings' already-working
-- pattern -- it doesn't check any Authorization header in its own code
-- either way (confirmed by reading its source), so this changes nothing
-- functionally except actually letting the cron sweep run for the first
-- time. The client-initiated calls (VenueForm/GigForm saves) keep sending
-- the signed-in user's real session JWT regardless, unaffected by this.

select cron.unschedule('daily-news-digest');
select cron.schedule(
  'daily-news-digest',
  '0 5-6 * * *',
  $$
  select net.http_post(
    url := 'https://uzblypxepztdramotjcc.supabase.co/functions/v1/daily-news-digest',
    headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_mrH4vEaixnUov_MkxEHR4g_poeswAPH"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

select cron.unschedule('gig-day-reminder');
select cron.schedule(
  'gig-day-reminder',
  '*/15 8-9 * * *',
  $$
  select net.http_post(
    url := 'https://uzblypxepztdramotjcc.supabase.co/functions/v1/gig-day-reminder',
    headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_mrH4vEaixnUov_MkxEHR4g_poeswAPH"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

select cron.unschedule('unconfirmed-roster-reminder');
select cron.schedule(
  'unconfirmed-roster-reminder',
  '0 */3 * * *',
  $$
  select net.http_post(
    url := 'https://uzblypxepztdramotjcc.supabase.co/functions/v1/unconfirmed-roster-reminder',
    headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_mrH4vEaixnUov_MkxEHR4g_poeswAPH"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

select cron.unschedule('nearby-places-sweep');
select cron.schedule(
  'nearby-places-sweep',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://uzblypxepztdramotjcc.supabase.co/functions/v1/refresh-venue-nearby-places',
    headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_mrH4vEaixnUov_MkxEHR4g_poeswAPH"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

create extension if not exists pg_cron;

-- Fires every 15 minutes across both UTC hours that "9:30am Europe/London"
-- can ever land on (08:30 during BST, 09:30 during GMT) -- the edge
-- function itself checks the real UK local time and no-ops outside the
-- actual 9:30 window, so this stays correct across the DST switch without
-- the schedule ever needing to change. The anon key here is the public,
-- client-exposed key (safe in a migration) -- verify_jwt is off on this
-- function (matching notify-admin/notify-musician's webhook-invoked
-- pattern), so it's only needed to satisfy Supabase's API gateway routing.
select cron.schedule(
  'gig-day-reminder',
  '*/15 8-9 * * *',
  $$
  select net.http_post(
    url := 'https://uzblypxepztdramotjcc.supabase.co/functions/v1/gig-day-reminder',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV6Ymx5cHhlcHp0ZHJhbW90amNjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1MDIyNTQsImV4cCI6MjA5ODA3ODI1NH0.Ph2Q4gYccbTu5PUvE9nJ8hkWDcDLz7AAwpAcAIzQR4Y"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

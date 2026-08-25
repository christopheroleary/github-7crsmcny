-- Every 10 minutes, refreshes one stale/missing venue (see
-- refresh-venue-nearby-places's sweep mode) -- kept to a small, frequent
-- cadence rather than a big batch on a long interval, since a single venue
-- refresh (5 categories against the free Overpass mirrors) already took
-- ~90s in testing and the Edge Function platform has its own execution
-- ceiling per invocation.
select cron.schedule(
  'nearby-places-sweep',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://uzblypxepztdramotjcc.supabase.co/functions/v1/refresh-venue-nearby-places',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV6Ymx5cHhlcHp0ZHJhbW90amNjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1MDIyNTQsImV4cCI6MjA5ODA3ODI1NH0.Ph2Q4gYccbTu5PUvE9nJ8hkWDcDLz7AAwpAcAIzQR4Y"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

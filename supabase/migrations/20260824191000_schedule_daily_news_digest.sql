-- Fires at the top of both UTC hours "6:00am Europe/London" can ever land
-- on (05:00 during BST, 06:00 during GMT) -- the edge function itself
-- checks the real UK local hour and no-ops outside 6am, plus checks
-- whether today's batch already exists, so this stays correct across the
-- DST switch and can't double-run even if both firings land on the same
-- UK day. Same pattern as gig-day-reminder.
select cron.schedule(
  'daily-news-digest',
  '0 5-6 * * *',
  $$
  select net.http_post(
    url := 'https://uzblypxepztdramotjcc.supabase.co/functions/v1/daily-news-digest',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV6Ymx5cHhlcHp0ZHJhbW90amNjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1MDIyNTQsImV4cCI6MjA5ODA3ODI1NH0.Ph2Q4gYccbTu5PUvE9nJ8hkWDcDLz7AAwpAcAIzQR4Y"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

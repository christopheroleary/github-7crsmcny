-- Unlike gig-day-reminder this isn't tied to a specific local wall-clock
-- moment (it's a relative "2+ days since added" check), so a plain fixed
-- interval is enough -- every 3 hours, no DST-window gymnastics needed. The
-- edge function's own admin_notified_at dedupe means running slightly more
-- or less often only changes how promptly the reminder lands, never how
-- many times it fires.
select cron.schedule(
  'unconfirmed-roster-reminder',
  '0 */3 * * *',
  $$
  select net.http_post(
    url := 'https://uzblypxepztdramotjcc.supabase.co/functions/v1/unconfirmed-roster-reminder',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV6Ymx5cHhlcHp0ZHJhbW90amNjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1MDIyNTQsImV4cCI6MjA5ODA3ODI1NH0.Ph2Q4gYccbTu5PUvE9nJ8hkWDcDLz7AAwpAcAIzQR4Y"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

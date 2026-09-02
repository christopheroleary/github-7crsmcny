-- Once a day, off-peak-ish but still a reasonable local morning (7am UTC).
-- Same cron.schedule/net.http_post template as every other scheduled job
-- (20260901020000_schedule_gig_photo_retention_sweep.sql), current
-- sb_publishable_... key.
select cron.schedule(
  'daily-tasks-digest',
  '0 7 * * *',
  $$
  select net.http_post(
    url := 'https://uzblypxepztdramotjcc.supabase.co/functions/v1/daily-tasks-digest',
    headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_mrH4vEaixnUov_MkxEHR4g_poeswAPH"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

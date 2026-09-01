-- Daily off-peak sweep -- deletion isn't latency-sensitive the way the
-- 10-minute nearby-places sweep is, so once a day is plenty. Same
-- cron.schedule/net.http_post template as every other scheduled job (see
-- 20260826170000_update_cron_jobs_to_publishable_key.sql), current
-- sb_publishable_... key.
select cron.schedule(
  'gig-photo-retention-sweep',
  '30 3 * * *',
  $$
  select net.http_post(
    url := 'https://uzblypxepztdramotjcc.supabase.co/functions/v1/cleanup-expired-gig-photos',
    headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_mrH4vEaixnUov_MkxEHR4g_poeswAPH"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

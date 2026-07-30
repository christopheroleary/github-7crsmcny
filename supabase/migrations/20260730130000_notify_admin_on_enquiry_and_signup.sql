create trigger "notify-admin-enquiry"
after insert on public.enquiries
for each row execute function supabase_functions.http_request(
  'https://uzblypxepztdramotjcc.supabase.co/functions/v1/notify-admin',
  'POST',
  '{"Content-type":"application/json","Authorization: Bearer":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV6Ymx5cHhlcHp0ZHJhbW90amNjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjUwMjI1NCwiZXhwIjoyMDk4MDc4MjU0fQ.ZhWSYfikjmyXTV3VAxo5VYhaq-rXUVPeQGjTZ-tzINU"}',
  '{}',
  '5000'
);

create trigger "notify-admin-signup"
after insert on public.profiles
for each row execute function supabase_functions.http_request(
  'https://uzblypxepztdramotjcc.supabase.co/functions/v1/notify-admin',
  'POST',
  '{"Content-type":"application/json","Authorization: Bearer":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV6Ymx5cHhlcHp0ZHJhbW90amNjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjUwMjI1NCwiZXhwIjoyMDk4MDc4MjU0fQ.ZhWSYfikjmyXTV3VAxo5VYhaq-rXUVPeQGjTZ-tzINU"}',
  '{}',
  '5000'
);

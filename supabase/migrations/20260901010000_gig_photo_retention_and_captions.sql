-- Retention window (admin-adjustable, mirrors receipt_monthly_scan_limit's
-- "trips first, no redeploy needed" reasoning -- except this one is a
-- storage-cost knob rather than a spend knob) and the AI-drafted-caption
-- feature's own table + cost guard setting.

insert into public.app_settings (key, value) values
  ('gig_photo_retention_days', '90'::jsonb)
on conflict (key) do nothing;

-- Unlike receipts.retain_until (advisory only -- nothing auto-deletes on
-- it, since silently destroying tax evidence would be a terrible
-- default), this one IS wired to an actual sweep -- see
-- cleanup-expired-gig-photos and the cron schedule in the next migration.
-- There's no legal reason to keep a gig photo, so auto-deletion here is
-- the right default rather than merely advisory.
create or replace function public.set_gig_photo_expiry()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  retention_days int;
begin
  select coalesce((value #>> '{}')::int, 90) into retention_days
  from public.app_settings where key = 'gig_photo_retention_days';
  new.expires_at := now() + make_interval(days => coalesce(retention_days, 90));
  return new;
end;
$function$;

create trigger gig_photos_set_expiry
before insert on public.gig_photos
for each row execute function public.set_gig_photo_expiry();

-- ── AI-drafted social captions ────────────────────────────────────────────────
-- Persisted so a leader can revisit a draft without re-spending an API
-- call, and gives the cost-guard counters below something to query
-- (mirrors receipts.extracted_at being the counter for extract-receipt's
-- guards). Only ever written by the generate-gig-caption Edge Function
-- (service role, after re-deriving the caller's own permission itself) --
-- the insert policy here is defence-in-depth, matching how receipts_update
-- exists even though only extract-receipt currently exercises it.
create table public.gig_photo_captions (
  id uuid primary key default gen_random_uuid(),
  gig_id uuid not null references public.gigs(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  photo_ids uuid[] not null,
  caption text not null,
  hashtags text[] not null default '{}',
  best_time_suggestion text,
  raw_response jsonb,
  created_at timestamptz not null default now()
);

create index gig_photo_captions_gig_id_idx on public.gig_photo_captions (gig_id, created_at desc);
create index gig_photo_captions_created_at_idx on public.gig_photo_captions (created_at);

alter table public.gig_photo_captions enable row level security;

create policy "gig_photo_captions_select" on public.gig_photo_captions for select
using (
  is_admin() or is_band_leader_of((select band_id from public.gigs where id = gig_id))
);

create policy "gig_photo_captions_insert" on public.gig_photo_captions for insert
with check (
  requested_by = auth.uid()
  and (is_admin() or is_band_leader_of((select band_id from public.gigs where id = gig_id)))
);

grant select, insert on public.gig_photo_captions to authenticated;
grant select, insert on public.gig_photo_captions to service_role;

-- ~500 caption drafts/month is a small, controlled ceiling for a feature
-- that (unlike receipt scanning) only band leaders/admins ever trigger,
-- not every musician -- same "trips before the provider-side cap does,
-- with a clear message, raisable without a redeploy" reasoning.
insert into public.app_settings (key, value) values
  ('caption_monthly_generation_limit', '500'::jsonb)
on conflict (key) do nothing;

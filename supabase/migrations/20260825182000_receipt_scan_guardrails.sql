-- Guardrails and quality signals for receipt scanning.
--
-- The Anthropic-side monthly spend cap is the last line of defence, and on
-- its own it has a nasty failure mode: whoever burns the budget takes the
-- feature down for everyone until the billing month rolls over. This adds a
-- ceiling we control, which trips FIRST, degrades with an explanatory
-- message, and can be raised without a redeploy.

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

-- Readable by any signed-in user so the UI can show what's left; only an
-- admin can change a limit.
create policy "app_settings_select" on public.app_settings for select
to authenticated using (true);

create policy "app_settings_write" on public.app_settings for all
to authenticated using (is_admin()) with check (is_admin());

grant select on public.app_settings to authenticated;
grant insert, update, delete on public.app_settings to authenticated;
grant select on public.app_settings to service_role;

-- ~3000 scans/month is roughly £6 at current per-receipt cost, comfortably
-- under a £10 provider cap, so ours trips well before theirs does.
insert into public.app_settings (key, value) values
  ('receipt_monthly_scan_limit', '3000'::jsonb)
on conflict (key) do nothing;

-- ── Quality + duplicate signals on the receipt itself ────────────────────────
alter table public.receipts
  -- SHA-256 of the uploaded bytes. Catches the same FILE being submitted
  -- twice (re-picking from the gallery, a double tap, a retry). Two separate
  -- photos of one receipt differ in every byte, so that case is caught after
  -- extraction by comparing merchant/date/total instead.
  add column content_hash text,
  -- Per-field 'high' | 'medium' | 'low' from the extractor, so the review UI
  -- can point at the fields worth actually checking rather than asking the
  -- musician to re-read all of them.
  add column field_confidence jsonb,
  -- Server-side sanity findings, e.g. subtotal + VAT not matching the total.
  add column quality_warnings jsonb;

create index receipts_content_hash_idx
  on public.receipts (profile_id, content_hash)
  where content_hash is not null;

-- Supports both the global monthly ceiling count and the existing per-user
-- daily cap, which both filter on extracted_at.
create index receipts_extracted_at_idx
  on public.receipts (extracted_at)
  where extracted_at is not null;

-- Fuzzy duplicate lookup after extraction: "have I already got this shop,
-- this date, this total?"
create index receipts_dupe_match_idx
  on public.receipts (profile_id, transaction_date, total_pence)
  where transaction_date is not null and total_pence is not null;

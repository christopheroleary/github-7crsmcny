-- Phase 3 of MTD-readiness work: the evidence behind an expense.
--
-- expenses/musician_claim_items already record WHAT was spent; HMRC also
-- wants proof, kept for at least 5 years after the 31 January submission
-- deadline (~6 in practice). HMRC explicitly accepts a legible photo or
-- scan in place of the paper, so a receipt photographed once at the gig
-- is a complete legal record on its own.
--
-- A receipt row is created the moment the photo lands, BEFORE anyone knows
-- what's on it -- extraction happens asynchronously in the extract-receipt
-- Edge Function, and the musician confirms the fields before any expense
-- is created. Hence the nullable extracted columns and the status column
-- rather than a straight foreign key off expenses.

-- UK tax years end 5 April. Used for retain_until below; immutable so it's
-- safe in an index or a generated column later if that's ever wanted.
create or replace function public.uk_tax_year_end(d date)
returns date
language sql
immutable
as $function$
  select case
    when d <= make_date(extract(year from d)::int, 4, 5)
      then make_date(extract(year from d)::int, 4, 5)
    else make_date(extract(year from d)::int + 1, 4, 5)
  end;
$function$;

create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,

  storage_path text not null,
  byte_size integer,

  -- pending  = uploaded, extraction not finished
  -- extracted= fields read, awaiting the musician's confirmation
  -- failed   = extraction errored; the image is still a valid record, the
  --            fields just have to be typed in by hand
  -- filed    = an expense or claim item now points at this receipt
  status text not null default 'pending'
    check (status in ('pending', 'extracted', 'failed', 'filed')),

  -- Everything below is what the model read off the image. All nullable on
  -- purpose: the extractor is instructed to return null rather than guess,
  -- because a wrong total silently entering someone's tax return is far
  -- worse than a blank box the musician has to fill in themselves.
  merchant_name text,
  transaction_date date,
  transaction_time time,
  total_pence integer check (total_pence is null or total_pence >= 0),
  subtotal_pence integer check (subtotal_pence is null or subtotal_pence >= 0),
  vat_pence integer check (vat_pence is null or vat_pence >= 0),
  vat_number text,
  currency text not null default 'GBP',
  payment_method text,
  -- [{ description, quantity, unit_price_pence, total_pence }, ...]
  line_items jsonb,
  suggested_category text,

  -- The model's full response, kept so a parsing bug can be fixed and the
  -- rows re-derived later without re-uploading or paying for a second pass.
  raw_extraction jsonb,
  extraction_error text,
  extracted_at timestamptz,

  -- When this stops being legally required. Nothing auto-deletes on this
  -- date -- silently destroying tax evidence would be a terrible default.
  -- It exists so a human (or a future cleanup job) can tell at a glance
  -- what is genuinely safe to dispose of.
  retain_until date,

  created_at timestamptz not null default now()
);

create index receipts_profile_idx on public.receipts (profile_id, created_at desc);
create index receipts_status_idx on public.receipts (profile_id, status);

-- transaction_date isn't known at insert time (it arrives with extraction),
-- so retain_until is recomputed whenever the date changes rather than being
-- fixed once on insert.
create or replace function public.set_receipt_retain_until()
returns trigger
language plpgsql
as $function$
begin
  new.retain_until :=
    (public.uk_tax_year_end(coalesce(new.transaction_date, current_date))
     + interval '6 years')::date;
  return new;
end;
$function$;

create trigger receipts_set_retain_until
before insert or update of transaction_date on public.receipts
for each row execute function public.set_receipt_retain_until();

alter table public.receipts enable row level security;

-- Mirrors the expenses policies exactly -- a musician's own financial
-- records, plus admin.
create policy "receipts_select" on public.receipts for select
using (profile_id = auth.uid() or is_admin());

create policy "receipts_insert" on public.receipts for insert
with check (profile_id = auth.uid() or is_admin());

create policy "receipts_update" on public.receipts for update
using (profile_id = auth.uid() or is_admin())
with check (profile_id = auth.uid() or is_admin());

create policy "receipts_delete" on public.receipts for delete
using (profile_id = auth.uid() or is_admin());

grant select, insert, update, delete on public.receipts to authenticated;
-- extract-receipt reads the row and writes the extracted fields back.
-- RLS bypass and table grants are separate layers -- service_role needs
-- this explicitly, it does not inherit it from being service_role.
grant select, update on public.receipts to service_role;

-- ── Linking receipts to what they're evidence for ────────────────────────────
-- on delete set null, NOT cascade: deleting an expense (a typo, a
-- duplicate) must never destroy the underlying legal record. The orphaned
-- receipt drops back to the "unfiled" pile instead.
alter table public.expenses
  add column receipt_id uuid references public.receipts(id) on delete set null;

alter table public.musician_claim_items
  add column receipt_id uuid references public.receipts(id) on delete set null;

create index expenses_receipt_idx on public.expenses (receipt_id) where receipt_id is not null;
create index musician_claim_items_receipt_idx on public.musician_claim_items (receipt_id) where receipt_id is not null;

-- ── Private storage bucket ───────────────────────────────────────────────────
-- public = false, unlike profile-pictures and band-logos. Those are shown
-- on day sheets and public invoices; a receipt is a financial document and
-- is only ever read by its owner or an admin, through a short-lived signed
-- URL.
--
-- image/jpeg and image/png are allowed alongside webp from the start:
-- canvas.toBlob('image/webp') silently falls back to PNG on some iOS
-- Safari builds, which already caused a live upload failure once (see
-- 20260815020000_widen_avatar_logo_bucket_mime_types.sql).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 5 * 1024 * 1024, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

-- Object paths are always "{user_id}/{receipt_id}.webp", so the owning
-- profile is the first path segment -- same keying as profile_pictures_*,
-- but note the read policy is scoped here rather than unconditional.
create policy "receipts_storage_read" on storage.objects for select
using (
  bucket_id = 'receipts'
  and (is_admin() or auth.uid() = (storage.foldername(name))[1]::uuid)
);

create policy "receipts_storage_insert" on storage.objects for insert
with check (
  bucket_id = 'receipts'
  and (is_admin() or auth.uid() = (storage.foldername(name))[1]::uuid)
);

create policy "receipts_storage_update" on storage.objects for update
using (
  bucket_id = 'receipts'
  and (is_admin() or auth.uid() = (storage.foldername(name))[1]::uuid)
);

create policy "receipts_storage_delete" on storage.objects for delete
using (
  bucket_id = 'receipts'
  and (is_admin() or auth.uid() = (storage.foldername(name))[1]::uuid)
);

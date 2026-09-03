-- Lets a band leader raise a payment claim on behalf of a dep who invoices
-- through their own tool (Xero etc.) outside Seeau, rather than building a
-- second, parallel "how do I pay someone for a gig" system. Unifies with
-- the existing musician_claims pipeline (approve/reject/"Mark paid
-- manually") instead of duplicating it -- a placeholder claim is a claim
-- like any other, just claimed on their behalf since they can't log in to
-- submit it themselves. The Stripe-automated payout path stays meaningless
-- for a placeholder (no stripe_connect_account_id -- they're not a
-- profile) and naturally doesn't appear, since MusicianClaimsAdmin.jsx's
-- Stripe button already gates on claim.profiles?.stripe_connect_status,
-- which is simply absent for a placeholder claim.
--
-- Deliberately NOT reusing receipts/musician_claim_items.receipt_id for
-- the attached evidence -- that whole pipeline (AI OCR extraction, blur/
-- quality checks, duplicate-photo detection) is tuned for "a musician
-- photographs their own purchase", which doesn't fit "attach a copy of
-- someone else's external invoice, or a link to it" at all. This is one
-- attachment per CLAIM (a dep's whole external invoice), not per line
-- item -- unlike a musician's own claim, which can itemise fee/travel/
-- expenses separately each with their own receipt.

alter table public.musician_claims alter column profile_id drop not null;

alter table public.musician_claims
  add column placeholder_id uuid references public.placeholder_musicians(id) on delete cascade;

alter table public.musician_claims
  add constraint musician_claims_claimant_check
  check (
    (profile_id is not null and placeholder_id is null)
    or (profile_id is null and placeholder_id is not null)
  );

alter table public.musician_claims add column external_link text;
alter table public.musician_claims add column attachment_path text;

create index musician_claims_placeholder_id_idx on public.musician_claims(placeholder_id) where placeholder_id is not null;

-- ── Creation RPCs, mirroring create_musician_claim/update_musician_claim ──
-- Deliberately separate functions rather than adding an optional
-- p_placeholder_id to the existing pair -- this is a structurally
-- different flow (leader composing on someone else's behalf, gated on the
-- LEADER's own Pro status and band-leadership of the gig) from a
-- musician's own self-service submission, and keeping them apart means
-- neither can accidentally regress the other. SECURITY DEFINER (unlike
-- the invoker-mode originals) since there is deliberately no INSERT policy
-- on musician_claims for "a leader inserting a placeholder_id row" --  the
-- authorization check lives here instead, once, rather than duplicated
-- into an RLS policy that would just be a second copy of the same rule.
create function public.create_placeholder_claim(
  p_gig_id uuid,
  p_placeholder_id uuid,
  p_notes text,
  p_items jsonb,
  p_external_link text default null,
  p_attachment_path text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_band_id uuid;
  v_claim_id uuid;
begin
  select band_id into v_band_id from public.gigs where id = p_gig_id;
  if v_band_id is null or not ((select public.is_admin()) or public.is_band_leader_of(v_band_id)) then
    raise exception 'Not authorised to raise a claim on this gig';
  end if;
  if not exists (select 1 from public.gig_lineup where gig_id = p_gig_id and placeholder_id = p_placeholder_id) then
    raise exception 'That dep is not on this gig''s roster';
  end if;
  if not exists (select 1 from public.profiles where id = (select auth.uid()) and (role = 'admin' or subscription_tier = 'pro')) then
    raise exception 'PRO_REQUIRED: Claims are a Pro feature. Upgrade to Pro in My Profile to raise one.';
  end if;

  insert into public.musician_claims (gig_id, placeholder_id, notes, external_link, attachment_path)
  values (p_gig_id, p_placeholder_id, p_notes, p_external_link, p_attachment_path)
  returning id into v_claim_id;

  insert into public.musician_claim_items (claim_id, category, description, amount_pence, sort_order)
  select v_claim_id, item->>'category', item->>'description', (item->>'amount_pence')::integer, (ord - 1)::integer
  from jsonb_array_elements(p_items) with ordinality as t(item, ord);

  return v_claim_id;
end;
$$;

create function public.update_placeholder_claim(
  p_claim_id uuid,
  p_notes text,
  p_items jsonb,
  p_external_link text default null,
  p_attachment_path text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_band_id uuid;
begin
  select g.band_id into v_band_id
  from public.musician_claims c join public.gigs g on g.id = c.gig_id
  where c.id = p_claim_id and c.placeholder_id is not null;

  if v_band_id is null or not ((select public.is_admin()) or public.is_band_leader_of(v_band_id)) then
    raise exception 'Not authorised to edit this claim';
  end if;
  if not exists (select 1 from public.profiles where id = (select auth.uid()) and (role = 'admin' or subscription_tier = 'pro')) then
    raise exception 'PRO_REQUIRED: Claims are a Pro feature. Upgrade to Pro in My Profile to edit one.';
  end if;

  update public.musician_claims
  set notes = p_notes, external_link = p_external_link, attachment_path = p_attachment_path,
      created_at = now(), status = 'pending'
  where id = p_claim_id;

  delete from public.musician_claim_items where claim_id = p_claim_id;

  insert into public.musician_claim_items (claim_id, category, description, amount_pence, sort_order)
  select p_claim_id, item->>'category', item->>'description', (item->>'amount_pence')::integer, (ord - 1)::integer
  from jsonb_array_elements(p_items) with ordinality as t(item, ord);
end;
$$;

revoke execute on function public.create_placeholder_claim(uuid, uuid, text, jsonb, text, text) from public;
revoke execute on function public.update_placeholder_claim(uuid, text, jsonb, text, text) from public;
grant execute on function public.create_placeholder_claim(uuid, uuid, text, jsonb, text, text) to authenticated;
grant execute on function public.update_placeholder_claim(uuid, text, jsonb, text, text) to authenticated;

-- ── Private storage bucket for the attached evidence ────────────────────
-- Path convention is "{band_id}/{claim_id-or-tmp-uuid}.ext" -- band_id as
-- the first segment (not the uploader's own profile id, unlike every other
-- bucket in this app) because the relevant question for who can read/write
-- one of these is "do you lead this band", not "did you personally upload
-- it" -- a second leader of the same band needs to see it too. image/jpeg,
-- image/png and application/pdf all allowed from the start -- deliberately
-- NOT converted to an image the way a receipt is; an external invoice PDF
-- is already small and rasterizing it would only make it larger and less
-- legible, and would need a PDF-rendering dependency this exFAT-drive dev
-- environment can't reliably install (see ProductTour.jsx's own comment
-- for the same class of problem with react-joyride).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dep-invoices', 'dep-invoices', false, 10 * 1024 * 1024, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

create policy "dep_invoices_storage_read" on storage.objects for select
using (
  bucket_id = 'dep-invoices'
  and (is_admin() or is_band_leader_of((storage.foldername(name))[1]::uuid))
);

create policy "dep_invoices_storage_insert" on storage.objects for insert
with check (
  bucket_id = 'dep-invoices'
  and (is_admin() or is_band_leader_of((storage.foldername(name))[1]::uuid))
);

create policy "dep_invoices_storage_delete" on storage.objects for delete
using (
  bucket_id = 'dep-invoices'
  and (is_admin() or is_band_leader_of((storage.foldername(name))[1]::uuid))
);

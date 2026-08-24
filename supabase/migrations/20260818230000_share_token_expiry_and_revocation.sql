-- SECURITY FIX: public share tokens were permanent and irrevocable.
--
-- Invoices, quotes and contracts are shared with clients via
-- /invoice/<token>, /quote/<token> and /contract/<token>, resolved by the
-- get_*_by_token SECURITY DEFINER functions. The token itself is fine:
-- gen_random_uuid() is 122 bits of entropy, so guessing one is not a
-- realistic attack and no rate limiting will change that arithmetic.
--
-- The problem is lifetime. A token, once issued, worked forever and could
-- not be withdrawn:
--   * no expiry -- a link in a two-year-old email still resolves today
--   * no revocation -- a link sent to the wrong client cannot be pulled
--   * no rotation -- there was no way to issue a replacement
-- and get_invoice_by_token returns bank_sort_code and bank_account_number,
-- so a single leaked link (forwarded mail, a shared client inbox, browser
-- history on a shared machine, a screenshot in a group chat) is a permanent
-- exposure of the band's bank details with no remedy short of changing bank
-- accounts.
--
-- This migration adds the three missing controls and reduces what a leaked
-- link is worth.

-- ── 1. Lifetime columns ─────────────────────────────────────────────────────
-- Added WITHOUT a default first, so existing rows land on NULL = never
-- expires and no link already sitting in a client's inbox stops working the
-- moment this deploys. The default is attached afterwards, so only newly
-- created documents pick up a window. (Doing it the other way round --
-- ADD COLUMN ... DEFAULT -- would stamp every existing row with an expiry,
-- and a corrective UPDATE would then wipe real expiries if this migration
-- were ever re-run.)
--
-- The windows differ because the documents have different natural
-- lifespans: a quote goes stale quickly, an invoice needs to stay reachable
-- through payment and end-of-year bookkeeping, and a contract must outlive
-- the gig it covers (which may be booked well over a year ahead).
alter table public.quotes
  add column if not exists share_token_expires_at timestamptz,
  add column if not exists share_token_revoked_at timestamptz;
alter table public.quotes
  alter column share_token_expires_at set default (now() + interval '90 days');

alter table public.invoices
  add column if not exists share_token_expires_at timestamptz,
  add column if not exists share_token_revoked_at timestamptz;
alter table public.invoices
  alter column share_token_expires_at set default (now() + interval '1 year');

alter table public.contracts
  add column if not exists share_token_expires_at timestamptz,
  add column if not exists share_token_revoked_at timestamptz;
alter table public.contracts
  alter column share_token_expires_at set default (now() + interval '2 years');

-- ── 2. Shared predicate ─────────────────────────────────────────────────────
-- A token is live when it has not been revoked and has not passed its
-- expiry. NULL expiry means no expiry.
--
-- STABLE, not IMMUTABLE: this reads now(), whose value is fixed within a
-- statement but varies between them. Declaring it immutable would let the
-- planner fold the result into a cached plan and keep serving an expired
-- token.
create or replace function public.share_token_is_live(
  p_expires_at timestamptz,
  p_revoked_at timestamptz
)
returns boolean language sql stable set search_path to 'public' as $$
  select p_revoked_at is null and (p_expires_at is null or p_expires_at > now());
$$;

-- ── 3. Token lookups now respect lifetime ───────────────────────────────────
-- Each function keeps its existing payload and adds the liveness check to
-- its WHERE clause, so an expired or revoked token returns no row and the
-- public view falls through to its existing "This link isn't valid, or has
-- expired" state. That message is deliberately identical for invalid,
-- expired and revoked tokens -- distinguishing them would confirm to a
-- stranger that a given token once existed.

create or replace function public.get_invoice_by_token(p_token uuid)
returns json
language sql stable security definer set search_path to 'public' as $$
  select json_build_object(
    'invoice', json_build_object(
      'id', i.id, 'status', i.status, 'due_date', i.due_date, 'issued_date', i.issued_date,
      'paid_date', i.paid_date, 'notes', i.notes, 'created_at', i.created_at
    ),
    'items', (
      select coalesce(json_agg(json_build_object(
        'id', ii.id, 'description', ii.description, 'quantity', ii.quantity,
        'unit_amount_pence', ii.unit_amount_pence, 'sort_order', ii.sort_order
      ) order by ii.sort_order), '[]'::json)
      from public.invoice_items ii where ii.invoice_id = i.id
    ),
    'payments', (
      select coalesce(json_agg(json_build_object(
        'id', ip.id, 'amount_pence', ip.amount_pence, 'paid_date', ip.paid_date, 'note', ip.note
      ) order by ip.paid_date), '[]'::json)
      from public.invoice_payments ip where ip.invoice_id = i.id
    ),
    'gig', json_build_object('id', g.id, 'gig_date', g.gig_date, 'start_time', g.start_time, 'end_time', g.end_time, 'fee_amount', g.fee_amount),
    'venue', case when v.id is null then null else json_build_object('name', v.name, 'address', v.address) end,
    'band', case when b.id is null then null else json_build_object(
      'name', b.name, 'invoice_name', b.invoice_name, 'contact_email', b.contact_email,
      'contact_phone', b.contact_phone, 'address', b.address, 'vat_number', b.vat_number, 'vat_rate', b.vat_rate,
      'invoice_notes', b.invoice_notes,
      -- BEHAVIOUR CHANGE: bank details are only sent while the invoice is
      -- actually payable. Once it is settled or cancelled the client has no
      -- further need for the sort code and account number, but the link
      -- often lives on in their inbox indefinitely -- this is what turns a
      -- stale leaked link from "here are our bank details" into "here is a
      -- receipt". To revert, replace each case expression below with the
      -- bare b.<column>.
      'bank_name', case when i.status in ('paid','cancelled') then null else b.bank_name end,
      'bank_account_name', case when i.status in ('paid','cancelled') then null else b.bank_account_name end,
      'bank_sort_code', case when i.status in ('paid','cancelled') then null else b.bank_sort_code end,
      'bank_account_number', case when i.status in ('paid','cancelled') then null else b.bank_account_number end,
      'doc_accent_colour', b.doc_accent_colour, 'doc_secondary_colour', b.doc_secondary_colour, 'logo_url', b.logo_url,
      'website_url', b.website_url, 'social_links', b.social_links
    ) end,
    'client', case when c.id is null then null else json_build_object('name', c.name, 'email', c.email, 'phone', c.phone) end,
    'stripe_payments_enabled', (
      case
        when not exists (select 1 from public.band_leaders where band_id = g.band_id) then true
        else exists (
          select 1 from public.band_leaders bl
          join public.profiles p on p.id = bl.profile_id
          where bl.band_id = g.band_id and (p.role = 'admin' or p.subscription_tier = 'pro')
        )
      end
    )
  )
  from public.invoices i
  join public.gigs g on g.id = i.gig_id
  left join public.venues v on v.id = g.venue_id
  left join public.bands b on b.id = g.band_id
  left join public.clients c on c.id = g.client_id
  where i.share_token = p_token
    and public.share_token_is_live(i.share_token_expires_at, i.share_token_revoked_at);
$$;

create or replace function public.get_quote_by_token(p_token uuid)
returns json
language sql stable security definer set search_path to 'public' as $$
  select json_build_object(
    'quote', json_build_object(
      'id', q.id, 'status', q.status, 'issued_date', q.issued_date, 'valid_until', q.valid_until,
      'notes', q.notes, 'created_at', q.created_at
    ),
    'items', (
      select coalesce(json_agg(json_build_object(
        'id', qi.id, 'description', qi.description, 'quantity', qi.quantity,
        'unit_amount_pence', qi.unit_amount_pence, 'sort_order', qi.sort_order
      ) order by qi.sort_order), '[]'::json)
      from public.quote_items qi where qi.quote_id = q.id
    ),
    'gig', json_build_object('id', g.id, 'gig_date', g.gig_date, 'start_time', g.start_time, 'end_time', g.end_time, 'fee_amount', g.fee_amount),
    'venue', case when v.id is null then null else json_build_object('name', v.name, 'address', v.address) end,
    'band', case when b.id is null then null else json_build_object(
      'name', b.name, 'invoice_name', b.invoice_name, 'contact_email', b.contact_email,
      'contact_phone', b.contact_phone, 'address', b.address, 'vat_number', b.vat_number,
      'doc_accent_colour', b.doc_accent_colour, 'doc_secondary_colour', b.doc_secondary_colour, 'logo_url', b.logo_url,
      'website_url', b.website_url, 'social_links', b.social_links
    ) end,
    'client', case when c.id is null then null else json_build_object('name', c.name, 'email', c.email, 'phone', c.phone) end
  )
  from public.quotes q
  join public.gigs g on g.id = q.gig_id
  left join public.venues v on v.id = g.venue_id
  left join public.bands b on b.id = g.band_id
  left join public.clients c on c.id = g.client_id
  where q.share_token = p_token
    and public.share_token_is_live(q.share_token_expires_at, q.share_token_revoked_at);
$$;

create or replace function public.get_contract_by_token(p_token uuid)
returns json
language sql stable security definer set search_path to 'public' as $$
  select json_build_object(
    'contract', json_build_object(
      'id', ct.id, 'status', ct.status, 'deposit_amount_pence', ct.deposit_amount_pence,
      'deposit_due_date', ct.deposit_due_date, 'balance_due_date', ct.balance_due_date,
      'cancellation_policy', ct.cancellation_policy, 'additional_terms', ct.additional_terms,
      'band_signee_name', ct.band_signee_name, 'band_signed_date', ct.band_signed_date,
      'band_signature_image', ct.band_signature_image,
      'client_signee_name', ct.client_signee_name, 'client_signed_date', ct.client_signed_date,
      'client_signature_image', ct.client_signature_image,
      'created_at', ct.created_at
    ),
    'gig', json_build_object('id', g.id, 'gig_date', g.gig_date, 'start_time', g.start_time, 'end_time', g.end_time, 'fee_amount', g.fee_amount),
    'venue', case when v.id is null then null else json_build_object('name', v.name, 'address', v.address) end,
    'band', case when b.id is null then null else json_build_object(
      'name', b.name, 'invoice_name', b.invoice_name, 'contact_email', b.contact_email,
      'contact_phone', b.contact_phone, 'address', b.address, 'vat_number', b.vat_number,
      'doc_accent_colour', b.doc_accent_colour, 'doc_secondary_colour', b.doc_secondary_colour, 'logo_url', b.logo_url,
      'website_url', b.website_url, 'social_links', b.social_links
    ) end,
    'client', case when c.id is null then null else json_build_object('name', c.name, 'email', c.email, 'phone', c.phone) end
  )
  from public.contracts ct
  join public.gigs g on g.id = ct.gig_id
  left join public.venues v on v.id = g.venue_id
  left join public.bands b on b.id = g.band_id
  left join public.clients c on c.id = g.client_id
  where ct.share_token = p_token
    and public.share_token_is_live(ct.share_token_expires_at, ct.share_token_revoked_at);
$$;

-- ── 4. Signing respects lifetime too ────────────────────────────────────────
-- Without this a client holding an expired or revoked contract link could
-- still sign it, since sign_contract_by_token looked the contract up by
-- token independently of get_contract_by_token.
create or replace function public.sign_contract_by_token(
  p_token uuid,
  p_signee_name text,
  p_signature_image text default null,
  p_method text default 'typed'
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_contract contracts%rowtype;
  v_name text;
  v_ip text;
  v_ua text;
  v_headers json;
begin
  v_name := trim(p_signee_name);
  if v_name = '' or v_name is null then
    raise exception 'Please enter a name to sign.';
  end if;
  if length(v_name) > 200 then
    raise exception 'That name is too long.';
  end if;
  if p_method not in ('typed', 'drawn') then
    raise exception 'Invalid signature method.';
  end if;
  if p_signature_image is not null and length(p_signature_image) > 300000 then
    raise exception 'Signature image is too large.';
  end if;

  select * into v_contract from public.contracts where share_token = p_token;
  -- Same generic message for missing, expired and revoked, so this cannot
  -- be used to probe whether a token ever existed.
  if not found or not public.share_token_is_live(v_contract.share_token_expires_at, v_contract.share_token_revoked_at) then
    raise exception 'Contract not found.';
  end if;
  if v_contract.client_signed_date is not null then
    raise exception 'This contract has already been signed.';
  end if;

  v_headers := nullif(current_setting('request.headers', true), '')::json;
  v_ua := v_headers ->> 'user-agent';
  v_ip := nullif(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1), '');

  update public.contracts
  set client_signee_name = v_name,
      client_signed_date = current_date,
      client_signed_at = now(),
      client_signature_ip = v_ip,
      client_signature_user_agent = v_ua,
      client_signature_method = p_method,
      client_signature_image = p_signature_image,
      status = case when band_signed_date is not null then 'signed' else status end
  where id = v_contract.id;

  return json_build_object('signee_name', v_name, 'signed_date', current_date);
end;
$function$;

-- ── 5. Rotation and revocation ──────────────────────────────────────────────
-- Rotating issues a fresh token, which invalidates the old one implicitly
-- (nothing matches it any more) and clears any prior revocation. Revoking
-- kills the link outright without issuing a replacement -- the right action
-- when a document went to the wrong recipient and no new link is wanted.
--
-- Both are SECURITY DEFINER because they write to tables the caller may not
-- hold direct grants on, so each re-checks authorisation explicitly against
-- the owning gig's band -- mirroring the existing contracts_manage /
-- invoices / quotes manage policies. anon is never granted execute.

create or replace function public.rotate_share_token(p_doc_type text, p_doc_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_gig_id uuid;
  v_band_id uuid;
  v_new_token uuid := gen_random_uuid();
begin
  if p_doc_type not in ('invoice', 'quote', 'contract') then
    raise exception 'Unknown document type.';
  end if;

  if p_doc_type = 'invoice' then
    select gig_id into v_gig_id from public.invoices where id = p_doc_id;
  elsif p_doc_type = 'quote' then
    select gig_id into v_gig_id from public.quotes where id = p_doc_id;
  else
    select gig_id into v_gig_id from public.contracts where id = p_doc_id;
  end if;

  if v_gig_id is null then
    raise exception 'Document not found.';
  end if;

  select band_id into v_band_id from public.gigs where id = v_gig_id;
  if not (public.is_admin() or (v_band_id is not null and public.is_band_leader_of(v_band_id))) then
    raise exception 'Not allowed.';
  end if;

  if p_doc_type = 'invoice' then
    update public.invoices
      set share_token = v_new_token, share_token_revoked_at = null,
          share_token_expires_at = now() + interval '1 year'
      where id = p_doc_id;
  elsif p_doc_type = 'quote' then
    update public.quotes
      set share_token = v_new_token, share_token_revoked_at = null,
          share_token_expires_at = now() + interval '90 days'
      where id = p_doc_id;
  else
    update public.contracts
      set share_token = v_new_token, share_token_revoked_at = null,
          share_token_expires_at = now() + interval '2 years'
      where id = p_doc_id;
  end if;

  return v_new_token;
end;
$$;

create or replace function public.revoke_share_token(p_doc_type text, p_doc_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_gig_id uuid;
  v_band_id uuid;
begin
  if p_doc_type not in ('invoice', 'quote', 'contract') then
    raise exception 'Unknown document type.';
  end if;

  if p_doc_type = 'invoice' then
    select gig_id into v_gig_id from public.invoices where id = p_doc_id;
  elsif p_doc_type = 'quote' then
    select gig_id into v_gig_id from public.quotes where id = p_doc_id;
  else
    select gig_id into v_gig_id from public.contracts where id = p_doc_id;
  end if;

  if v_gig_id is null then
    raise exception 'Document not found.';
  end if;

  select band_id into v_band_id from public.gigs where id = v_gig_id;
  if not (public.is_admin() or (v_band_id is not null and public.is_band_leader_of(v_band_id))) then
    raise exception 'Not allowed.';
  end if;

  if p_doc_type = 'invoice' then
    update public.invoices set share_token_revoked_at = now() where id = p_doc_id;
  elsif p_doc_type = 'quote' then
    update public.quotes set share_token_revoked_at = now() where id = p_doc_id;
  else
    update public.contracts set share_token_revoked_at = now() where id = p_doc_id;
  end if;
end;
$$;

revoke execute on function public.rotate_share_token(text, uuid) from anon;
revoke execute on function public.revoke_share_token(text, uuid) from anon;
grant execute on function public.rotate_share_token(text, uuid) to authenticated;
grant execute on function public.revoke_share_token(text, uuid) to authenticated;

-- Upgrades the typed-name-only signature into a real audit trail (exact
-- timestamp, IP, user-agent) plus an optional drawn signature image, for
-- both the band's and the client's signature. IP/user-agent come from the
-- request.headers GUC PostgREST sets on every call -- reliable for the
-- band side (an authenticated table update), best-effort for the public
-- token-based side (x-forwarded-for can in principle be spoofed by
-- whoever sends the request, same trust level as most low-stakes audit
-- logging, not a security control).
alter table contracts
  add column client_signed_at timestamptz,
  add column client_signature_ip text,
  add column client_signature_user_agent text,
  add column client_signature_method text,
  add column client_signature_image text,
  add column band_signed_at timestamptz,
  add column band_signature_ip text,
  add column band_signature_user_agent text,
  add column band_signature_method text,
  add column band_signature_image text;

-- Client signs via the public share link. One-time only (rejects if
-- already signed), server-stamped timestamp, now also captures the
-- signing method (typed/drawn) and an optional drawn signature image.
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
  if not found then
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

grant execute on function public.sign_contract_by_token(uuid, text, text, text) to anon, authenticated;

-- Band side, invoked by an authenticated admin/band leader. Runs as the
-- caller (security invoker) so the existing RLS UPDATE policy on
-- contracts is what actually authorizes this -- no permission logic
-- duplicated here, just bundles in the same header-derived audit capture
-- used on the client side.
create or replace function public.sign_contract_as_band(
  p_contract_id uuid,
  p_signee_name text,
  p_signature_image text default null,
  p_method text default 'typed'
)
returns json
language plpgsql
security invoker
set search_path to 'public'
as $function$
declare
  v_name text;
  v_ip text;
  v_ua text;
  v_headers json;
  v_signed_date date;
begin
  v_name := trim(p_signee_name);
  if v_name = '' or v_name is null then
    raise exception 'Please enter a name to sign.';
  end if;
  if p_method not in ('typed', 'drawn') then
    raise exception 'Invalid signature method.';
  end if;
  if p_signature_image is not null and length(p_signature_image) > 300000 then
    raise exception 'Signature image is too large.';
  end if;

  v_headers := nullif(current_setting('request.headers', true), '')::json;
  v_ua := v_headers ->> 'user-agent';
  v_ip := nullif(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1), '');

  update public.contracts
  set band_signee_name = v_name,
      band_signed_date = current_date,
      band_signed_at = now(),
      band_signature_ip = v_ip,
      band_signature_user_agent = v_ua,
      band_signature_method = p_method,
      band_signature_image = p_signature_image,
      status = case when client_signed_date is not null then 'signed' else status end
  where id = p_contract_id
  returning band_signed_date into v_signed_date;

  if not found then
    raise exception 'Contract not found, or you do not have permission to sign it.';
  end if;

  return json_build_object('signee_name', v_name, 'signed_date', v_signed_date);
end;
$function$;

grant execute on function public.sign_contract_as_band(uuid, text, text, text) to authenticated;

-- Expose the new drawn-signature fields to the public contract view.
create or replace function public.get_contract_by_token(p_token uuid)
 returns json
 language sql
 stable security definer
 set search_path to 'public'
as $function$
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
  where ct.share_token = p_token;
$function$;

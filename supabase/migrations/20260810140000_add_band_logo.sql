-- Band logo, for invoices/quotes/contracts. Upload-based rather than an
-- external image URL -- a raw URL means the band has no control over what
-- renders on their own documents (the host can swap the image any time,
-- including to something inappropriate), leaks the client's IP to whatever
-- third party hosts it every time they open an invoice, and breaks
-- silently forever if that host ever goes down or blocks hotlinking.
-- Uploaded logos are resized/compressed client-side before upload (see
-- src/utils/resizeImage.js) to stay well within the free storage tier.
alter table public.bands add column logo_url text;

insert into storage.buckets (id, name, public)
values ('band-logos', 'band-logos', true)
on conflict (id) do nothing;

-- Public read (documents render for clients with no login), write scoped
-- to admin or the leader of the specific band the logo belongs to. Object
-- paths are always "{band_id}/logo.webp", so the band a write targets is
-- just the first path segment.
create policy "band_logos_read" on storage.objects for select
using (bucket_id = 'band-logos');

create policy "band_logos_insert" on storage.objects for insert
with check (
  bucket_id = 'band-logos'
  and (is_admin() or is_band_leader_of((storage.foldername(name))[1]::uuid))
);

create policy "band_logos_update" on storage.objects for update
using (
  bucket_id = 'band-logos'
  and (is_admin() or is_band_leader_of((storage.foldername(name))[1]::uuid))
);

create policy "band_logos_delete" on storage.objects for delete
using (
  bucket_id = 'band-logos'
  and (is_admin() or is_band_leader_of((storage.foldername(name))[1]::uuid))
);

create or replace function public.get_invoice_by_token(p_token uuid)
 returns json
 language sql
 stable security definer
 set search_path to 'public'
as $function$
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
      'invoice_notes', b.invoice_notes, 'bank_name', b.bank_name, 'bank_account_name', b.bank_account_name,
      'bank_sort_code', b.bank_sort_code, 'bank_account_number', b.bank_account_number,
      'doc_accent_colour', b.doc_accent_colour, 'doc_secondary_colour', b.doc_secondary_colour, 'logo_url', b.logo_url
    ) end,
    'client', case when c.id is null then null else json_build_object('name', c.name, 'email', c.email, 'phone', c.phone) end
  )
  from public.invoices i
  join public.gigs g on g.id = i.gig_id
  left join public.venues v on v.id = g.venue_id
  left join public.bands b on b.id = g.band_id
  left join public.clients c on c.id = g.client_id
  where i.share_token = p_token;
$function$;

create or replace function public.get_quote_by_token(p_token uuid)
 returns json
 language sql
 stable security definer
 set search_path to 'public'
as $function$
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
      'doc_accent_colour', b.doc_accent_colour, 'doc_secondary_colour', b.doc_secondary_colour, 'logo_url', b.logo_url
    ) end,
    'client', case when c.id is null then null else json_build_object('name', c.name, 'email', c.email, 'phone', c.phone) end
  )
  from public.quotes q
  join public.gigs g on g.id = q.gig_id
  left join public.venues v on v.id = g.venue_id
  left join public.bands b on b.id = g.band_id
  left join public.clients c on c.id = g.client_id
  where q.share_token = p_token;
$function$;

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
      'client_signee_name', ct.client_signee_name, 'client_signed_date', ct.client_signed_date,
      'created_at', ct.created_at
    ),
    'gig', json_build_object('id', g.id, 'gig_date', g.gig_date, 'start_time', g.start_time, 'end_time', g.end_time, 'fee_amount', g.fee_amount),
    'venue', case when v.id is null then null else json_build_object('name', v.name, 'address', v.address) end,
    'band', case when b.id is null then null else json_build_object(
      'name', b.name, 'invoice_name', b.invoice_name, 'contact_email', b.contact_email,
      'contact_phone', b.contact_phone, 'address', b.address, 'vat_number', b.vat_number,
      'doc_accent_colour', b.doc_accent_colour, 'doc_secondary_colour', b.doc_secondary_colour, 'logo_url', b.logo_url
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

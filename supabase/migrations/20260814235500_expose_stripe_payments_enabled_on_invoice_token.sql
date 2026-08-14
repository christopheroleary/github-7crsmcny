-- Client Stripe payment acceptance is a Pro feature for band leaders. A band
-- with no explicit band_leaders row is a legacy/admin-run band (the schema
-- predates band_leaders) -- those always stay enabled since admin bypasses
-- Pro everywhere else too. A band with assigned leaders only gets Stripe
-- payments if at least one of those leaders is admin or Pro.
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
      'invoice_notes', b.invoice_notes, 'bank_name', b.bank_name, 'bank_account_name', b.bank_account_name,
      'bank_sort_code', b.bank_sort_code, 'bank_account_number', b.bank_account_number,
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
  where i.share_token = p_token;
$$;

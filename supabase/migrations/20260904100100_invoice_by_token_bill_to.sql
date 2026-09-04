-- Adds a resolved 'bill_to' key to get_invoice_by_token's response,
-- pointing at whichever of invoices.bill_to_band_id / bill_to_venue_id /
-- bill_to_client_id is set (band takes priority, since it's the richest
-- shape and the most deliberate override), falling back to today's
-- gigs.client_id-derived 'client' when none are set -- exactly today's
-- behaviour for every existing invoice. The existing 'client'/'venue'/
-- 'band' keys are untouched, so anything still reading them directly
-- keeps working unchanged. get_quote_by_token/get_contract_by_token are
-- not touched by this migration -- quotes/contracts don't get a bill_to
-- picker in this pass.
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
    'bill_to', case
      when bt_band.id is not null then json_build_object(
        'type', 'band', 'name', coalesce(bt_band.invoice_name, bt_band.name),
        'email', bt_band.contact_email, 'phone', bt_band.contact_phone, 'address', bt_band.address
      )
      when bt_venue.id is not null then json_build_object(
        'type', 'venue', 'name', bt_venue.name, 'email', bt_venue.email,
        'phone', bt_venue.phone, 'address', bt_venue.address
      )
      when bt_client.id is not null then json_build_object(
        'type', 'client', 'name', bt_client.name, 'email', bt_client.email, 'phone', bt_client.phone, 'address', null
      )
      when c.id is not null then json_build_object(
        'type', 'client', 'name', c.name, 'email', c.email, 'phone', c.phone, 'address', null
      )
      else null
    end,
    'stripe_payments_enabled', (
      case
        when not exists (select 1 from public.band_leaders where band_id = g.band_id) then true
        when exists (
          select 1 from public.band_leaders bl
          join public.profiles p on p.id = bl.profile_id
          where bl.band_id = g.band_id and p.role = 'admin'
        ) then true
        -- A purely independently-led band also needs its own Connect
        -- account active -- otherwise a paid Checkout session would have
        -- nowhere real to send the money. Admin-led/leaderless bands
        -- (above) are unaffected.
        else (
          exists (
            select 1 from public.band_leaders bl
            join public.profiles p on p.id = bl.profile_id
            where bl.band_id = g.band_id and p.subscription_tier = 'pro'
          )
          and b.stripe_connect_status = 'active'
        )
      end
    )
  )
  from public.invoices i
  join public.gigs g on g.id = i.gig_id
  left join public.venues v on v.id = g.venue_id
  left join public.bands b on b.id = g.band_id
  left join public.clients c on c.id = g.client_id
  left join public.clients bt_client on bt_client.id = i.bill_to_client_id
  left join public.venues  bt_venue  on bt_venue.id  = i.bill_to_venue_id
  left join public.bands   bt_band   on bt_band.id   = i.bill_to_band_id
  where i.share_token = p_token
    and public.share_token_is_live(i.share_token_expires_at, i.share_token_revoked_at);
$function$;

-- Per-band Stripe Connect, so an independently-run band's client invoice
-- payments land in that band's own bank account instead of pooling in the
-- platform's single account. Mirrors 20260814112458_add_stripe_connect_payouts.sql
-- (the existing musician-payout Connect setup) at the band level -- same
-- Express/recipient/application-application shape, same webhook-driven
-- status caching.
--
-- A band led (even partly) by the platform admin, or with no leaders at
-- all, keeps using the existing direct-platform-account checkout flow
-- unchanged -- that money is legitimately the platform owner's own
-- revenue, so there's nothing to route anywhere and no onboarding to do.
-- Only a band whose leaders are all genuinely independent (non-admin)
-- needs its own Connect account before "Pay now" can appear.

alter table public.bands
  add column stripe_connect_account_id text unique,
  add column stripe_connect_status text; -- null (not started) | 'pending' | 'active' | 'restricted'

comment on column public.bands.stripe_connect_status is
  'Cached from Stripe account.updated webhook events (see stripe-connect-webhook). active = the band''s own Connect account can receive transfers, so invoice payments can be routed to it instead of the platform account.';

-- Same gap profiles had before protect_subscription_fields was added:
-- bands_update_admin lets any co-leader (is_band_leader_of) or the band's
-- own created_by update arbitrary columns on their band, with no column
-- restriction and no WITH CHECK -- without this trigger a leader could
-- `.update({ stripe_connect_status: 'active' })` their own band directly
-- from the browser console, skipping Stripe's real onboarding entirely and
-- making "Pay now" appear with nowhere real for the money to go.
create or replace function public.protect_band_connect_fields()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.role() <> 'service_role' and not public.is_admin() then
    new.stripe_connect_account_id := old.stripe_connect_account_id;
    new.stripe_connect_status := old.stripe_connect_status;
  end if;
  return new;
end;
$$;

create trigger protect_band_connect_fields_trigger
  before update on public.bands
  for each row execute function public.protect_band_connect_fields();

-- bands has no service_role grants at all today (same systemic gap
-- profiles/invoices each had before their own fix migrations) -- the new
-- create-band-connect-account/sync-band-connect-status/stripe-connect-webhook
-- edge functions need to read band contact details broadly but only ever
-- write the two columns they own.
grant select on public.bands to service_role;
grant update (stripe_connect_account_id, stripe_connect_status) on public.bands to service_role;

-- Extends stripe_payments_enabled: a band with only independent (non-admin)
-- leaders now also needs its own Connect account active, not just a Pro
-- subscription -- otherwise a paid Checkout session would have nowhere
-- real to send the money. Admin-led and leaderless bands are unchanged
-- (still bypass both the Pro check and the new Connect check).
create or replace function public.get_invoice_by_token(p_token uuid)
returns json
language sql
stable
security definer
set search_path to 'public'
as $$
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
  where i.share_token = p_token
    and public.share_token_is_live(i.share_token_expires_at, i.share_token_revoked_at);
$$;

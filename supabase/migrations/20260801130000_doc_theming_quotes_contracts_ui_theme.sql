-- Phase 1 of: per-band document theming + Quotes + Contracts + app-wide UI theme.
-- See plan: per-band accent/secondary colours applied to invoices/quotes/
-- contracts (new), plus a separate app-wide UI theme preset on profiles.

-- ---------------------------------------------------------------------
-- Band document theme colours. Defaults match the current hardcoded
-- amber/teal exactly, so existing bands render unchanged until someone
-- actually customizes them. Already covered by the existing
-- bands_update_admin policy (is_admin() OR is_band_leader_of(id) OR
-- created_by = auth.uid()) -- no RLS change needed.
-- ---------------------------------------------------------------------
alter table public.bands add column doc_accent_colour text not null default '#c8862e';
alter table public.bands add column doc_secondary_colour text not null default '#1f3d3a';

-- ---------------------------------------------------------------------
-- App-wide UI theme preference. Already covered by the existing
-- profiles_update_own policy (id = auth.uid() OR is_admin()) -- no RLS
-- change needed. No CHECK constraint: the React picker constrains the
-- list of valid presets, keeping future additions migration-free.
-- ---------------------------------------------------------------------
alter table public.profiles add column ui_theme text not null default 'default';

-- ---------------------------------------------------------------------
-- Quotes -- structural mirror of invoices/invoice_items.
-- ---------------------------------------------------------------------
create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  gig_id uuid not null references public.gigs(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft','sent','accepted','declined','expired')),
  issued_date date,
  valid_until date,
  share_token uuid not null default gen_random_uuid() unique,
  notes text,
  converted_invoice_id uuid references public.invoices(id),
  created_at timestamptz not null default now()
);

create table public.quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  description text not null,
  quantity numeric not null default 1,
  unit_amount_pence integer not null default 0,
  sort_order integer not null default 0
);

alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;

create policy quotes_manage on public.quotes for all to public
using (
  is_admin() or exists (
    select 1 from public.gigs g where g.id = quotes.gig_id and is_band_leader_of(g.band_id)
  )
)
with check (
  is_admin() or exists (
    select 1 from public.gigs g where g.id = quotes.gig_id and is_band_leader_of(g.band_id)
  )
);

create policy quote_items_manage on public.quote_items for all to public
using (
  is_admin() or exists (
    select 1 from public.quotes q join public.gigs g on g.id = q.gig_id
    where q.id = quote_items.quote_id and is_band_leader_of(g.band_id)
  )
)
with check (
  is_admin() or exists (
    select 1 from public.quotes q join public.gigs g on g.id = q.gig_id
    where q.id = quote_items.quote_id and is_band_leader_of(g.band_id)
  )
);

grant select, insert, update, delete on public.quotes to authenticated;
grant select, insert, update, delete on public.quote_items to authenticated;

-- ---------------------------------------------------------------------
-- Contracts -- structured fields, signed off-app (band/client signature
-- name + date are recorded manually after a signature obtained outside
-- the app; no in-app e-signature capture). Fee is a read-only reference
-- to gigs.fee_amount, not duplicated here.
-- ---------------------------------------------------------------------
create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  gig_id uuid not null references public.gigs(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft','sent','signed')),
  deposit_amount_pence integer,
  deposit_due_date date,
  balance_due_date date,
  cancellation_policy text,
  additional_terms text,
  band_signee_name text,
  band_signed_date date,
  client_signee_name text,
  client_signed_date date,
  share_token uuid not null default gen_random_uuid() unique,
  created_at timestamptz not null default now()
);

alter table public.contracts enable row level security;

create policy contracts_manage on public.contracts for all to public
using (
  is_admin() or exists (
    select 1 from public.gigs g where g.id = contracts.gig_id and is_band_leader_of(g.band_id)
  )
)
with check (
  is_admin() or exists (
    select 1 from public.gigs g where g.id = contracts.gig_id and is_band_leader_of(g.band_id)
  )
);

grant select, insert, update, delete on public.contracts to authenticated;

-- ---------------------------------------------------------------------
-- Public, no-login share access. RLS is row-level and can't restrict
-- "only if the caller supplied the right token" -- a broad anon SELECT
-- policy would leak every invoice/quote/contract to anyone with the
-- public API key. Instead these SECURITY DEFINER RPCs look up a single
-- row by exact token match and return only that row's display data,
-- bypassing table RLS entirely rather than broadening it. anon has no
-- direct table grants on invoices/quotes/contracts (confirmed for
-- invoices; matched here for quotes/contracts) -- this is the only way
-- a logged-out visitor can read one of these documents.
-- ---------------------------------------------------------------------
create or replace function public.get_invoice_by_token(p_token uuid)
returns json
language sql
stable security definer
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
    'gig', json_build_object('id', g.id, 'gig_date', g.gig_date, 'start_time', g.start_time, 'end_time', g.end_time, 'fee_amount', g.fee_amount),
    'venue', case when v.id is null then null else json_build_object('name', v.name, 'address', v.address) end,
    'band', case when b.id is null then null else json_build_object(
      'name', b.name, 'invoice_name', b.invoice_name, 'contact_email', b.contact_email,
      'contact_phone', b.contact_phone, 'address', b.address, 'vat_number', b.vat_number,
      'invoice_notes', b.invoice_notes, 'bank_name', b.bank_name, 'bank_account_name', b.bank_account_name,
      'bank_sort_code', b.bank_sort_code, 'bank_account_number', b.bank_account_number,
      'doc_accent_colour', b.doc_accent_colour, 'doc_secondary_colour', b.doc_secondary_colour
    ) end,
    'client', case when c.id is null then null else json_build_object('name', c.name, 'email', c.email, 'phone', c.phone) end
  )
  from public.invoices i
  join public.gigs g on g.id = i.gig_id
  left join public.venues v on v.id = g.venue_id
  left join public.bands b on b.id = g.band_id
  left join public.clients c on c.id = g.client_id
  where i.share_token = p_token;
$$;

create or replace function public.get_quote_by_token(p_token uuid)
returns json
language sql
stable security definer
set search_path to 'public'
as $$
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
      'doc_accent_colour', b.doc_accent_colour, 'doc_secondary_colour', b.doc_secondary_colour
    ) end,
    'client', case when c.id is null then null else json_build_object('name', c.name, 'email', c.email, 'phone', c.phone) end
  )
  from public.quotes q
  join public.gigs g on g.id = q.gig_id
  left join public.venues v on v.id = g.venue_id
  left join public.bands b on b.id = g.band_id
  left join public.clients c on c.id = g.client_id
  where q.share_token = p_token;
$$;

create or replace function public.get_contract_by_token(p_token uuid)
returns json
language sql
stable security definer
set search_path to 'public'
as $$
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
      'doc_accent_colour', b.doc_accent_colour, 'doc_secondary_colour', b.doc_secondary_colour
    ) end,
    'client', case when c.id is null then null else json_build_object('name', c.name, 'email', c.email, 'phone', c.phone) end
  )
  from public.contracts ct
  join public.gigs g on g.id = ct.gig_id
  left join public.venues v on v.id = g.venue_id
  left join public.bands b on b.id = g.band_id
  left join public.clients c on c.id = g.client_id
  where ct.share_token = p_token;
$$;

grant execute on function public.get_invoice_by_token(uuid) to anon, authenticated;
grant execute on function public.get_quote_by_token(uuid) to anon, authenticated;
grant execute on function public.get_contract_by_token(uuid) to anon, authenticated;

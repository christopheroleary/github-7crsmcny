-- Deposit / partial payment tracking. Invoices were previously binary
-- (draft/sent/paid/overdue) with no way to record a deposit received at
-- booking and a balance later -- a real gap for a wedding/function-band
-- business where that's the normal payment pattern.
--
-- Deliberately a ledger of individual payments rather than a single
-- "deposit_pence" column: naturally supports a deposit + balance, several
-- partial payments, or a correction, and "amount paid so far" is just
-- sum(amount_pence) rather than a field that has to be kept in sync by
-- hand. invoices.status stays the authoritative high-level state (an
-- admin can still mark something 'paid' directly for a cash-in-hand
-- payment with no ledger entry) -- the app syncs status to 'paid'
-- automatically once recorded payments cover the total, and back off it
-- if a payment is later removed, but never overrides a status the admin
-- set some other way.
create table public.invoice_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  amount_pence integer not null check (amount_pence > 0),
  paid_date date not null default current_date,
  note text,
  created_at timestamptz not null default now()
);

alter table public.invoice_payments enable row level security;

-- Mirrors the invoices_manage policy exactly (same admin-or-band-leader-
-- of-this-gig's-band access), just joined one hop further through invoices.
create policy "invoice_payments_manage" on public.invoice_payments for all
using (
  is_admin() or exists (
    select 1 from public.invoices i join public.gigs g on g.id = i.gig_id
    where i.id = invoice_payments.invoice_id and is_band_leader_of(g.band_id)
  )
)
with check (
  is_admin() or exists (
    select 1 from public.invoices i join public.gigs g on g.id = i.gig_id
    where i.id = invoice_payments.invoice_id and is_band_leader_of(g.band_id)
  )
);

grant select, insert, update, delete on public.invoice_payments to authenticated;

-- Public invoice share link now also returns the payment breakdown so a
-- client can see what they've paid and what's left, not just a binary
-- paid/unpaid stamp.
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
$function$;

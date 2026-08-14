-- Stripe Checkout support for client invoice payments. invoice_payments was
-- already a ledger (see 20260808120000_add_invoice_payments.sql) -- a
-- Stripe-collected payment is just another row in it, tagged with which
-- payment_intent produced it.
--
-- stripe_payment_intent_id is unique so a duplicate webhook delivery (Stripe
-- explicitly does not guarantee exactly-once delivery) fails the insert
-- instead of double-counting the payment. stripe_webhook_events is a second,
-- belt-and-braces idempotency check at the event level, since Stripe's own
-- recommended pattern is to record the event id before acting on it.
alter table public.invoice_payments
  add column stripe_payment_intent_id text unique;

create table public.stripe_webhook_events (
  id text primary key,
  created_at timestamptz not null default now()
);

alter table public.stripe_webhook_events enable row level security;
-- Written only by the webhook Edge Function (service_role, which bypasses
-- RLS entirely) -- no policy grants any access to authenticated/anon.

-- The status-sync logic that used to live only in GigInvoice.jsx's
-- syncStatusToPayments() (client-side JS, so unreachable from a webhook,
-- which has no browser) -- pulled out here so both the admin's manual
-- "Record payment" action and the Stripe webhook call the same code path.
-- Deliberately security invoker, not definer: the existing RLS policies
-- (invoices_manage / invoice_payments_manage -- admin or band-leader-of-
-- this-gig's-band) already correctly authorize exactly this insert+update
-- for an authenticated admin, and the webhook calls in as service_role,
-- which bypasses RLS regardless of invoker/definer. No need to duplicate
-- the authorization check by hand.
create or replace function public.sync_invoice_payment_status(p_invoice_id uuid)
 returns void
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_total_due bigint;
  v_total_paid bigint;
  v_latest_date date;
  v_status text;
begin
  select coalesce(sum(ii.unit_amount_pence * ii.quantity), 0) into v_total_due
  from public.invoice_items ii where ii.invoice_id = p_invoice_id;

  select coalesce(sum(ip.amount_pence), 0), max(ip.paid_date)
    into v_total_paid, v_latest_date
  from public.invoice_payments ip where ip.invoice_id = p_invoice_id;

  select i.status into v_status from public.invoices i where i.id = p_invoice_id;

  if v_total_due > 0 and v_total_paid >= v_total_due and v_status <> 'paid' then
    update public.invoices set status = 'paid', paid_date = v_latest_date where id = p_invoice_id;
  elsif v_status = 'paid' and v_total_paid < v_total_due then
    update public.invoices set status = 'sent', paid_date = null where id = p_invoice_id;
  end if;
end;
$function$;

create or replace function public.record_invoice_payment(
  p_invoice_id uuid,
  p_amount_pence integer,
  p_paid_date date default current_date,
  p_note text default null,
  p_stripe_payment_intent_id text default null
)
 returns public.invoice_payments
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_payment public.invoice_payments;
begin
  insert into public.invoice_payments (invoice_id, amount_pence, paid_date, note, stripe_payment_intent_id)
  values (p_invoice_id, p_amount_pence, coalesce(p_paid_date, current_date), p_note, p_stripe_payment_intent_id)
  returning * into v_payment;

  perform public.sync_invoice_payment_status(p_invoice_id);

  return v_payment;
end;
$function$;

grant execute on function public.sync_invoice_payment_status(uuid) to authenticated, service_role;
grant execute on function public.record_invoice_payment(uuid, integer, date, text, text) to authenticated, service_role;

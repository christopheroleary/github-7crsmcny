-- The Stripe payment migrations granted DML on invoices/invoice_payments to
-- `authenticated` (for the admin UI) but never to `service_role`. That went
-- unnoticed because record_invoice_payment() and sync_invoice_payment_status()
-- are SECURITY INVOKER, not DEFINER -- they run with the CALLER's privileges,
-- and the Stripe webhook + create-invoice-checkout Edge Functions call them
-- (and query invoices directly) using the service-role client. Without an
-- explicit grant, service_role could bypass RLS but still hit a flat
-- "permission denied for table invoices" at the privilege-check layer, which
-- RLS bypass has no effect on.
grant select, update on public.invoices to service_role;
grant select on public.invoice_items to service_role;
grant select, insert on public.invoice_payments to service_role;
grant select, insert on public.stripe_webhook_events to service_role;

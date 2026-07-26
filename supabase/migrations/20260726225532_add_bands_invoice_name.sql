alter table public.bands add column invoice_name text;
comment on column public.bands.invoice_name is 'Official/legal name to show on invoices and musician claims, if different from the performing name.';

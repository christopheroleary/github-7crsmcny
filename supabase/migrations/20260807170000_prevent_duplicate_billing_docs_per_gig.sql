-- Bug: GigInvoice.jsx/GigQuote.jsx/GigContract.jsx all fetch their doc via
-- .maybeSingle(), which errors (silently -- only `data` was destructured,
-- not `error`) the moment more than one row exists for a gig_id. Combined
-- with handleCreate()/handleConvertToInvoice() having no check against an
-- existing row before inserting, a gig could accumulate duplicate drafts --
-- confirmed happened for real (Stripey Badger had 8 invoice rows, the
-- earliest two from a double "Convert to invoice" click, the rest from
-- repeated "Create invoice" clicks once the display broke and kept
-- silently failing). The UI model has only ever supported one of each
-- doc type per gig, so a unique constraint matches actual intended
-- behaviour and makes this class of bug impossible going forward.
alter table public.invoices add constraint invoices_gig_id_unique unique (gig_id);
alter table public.quotes add constraint quotes_gig_id_unique unique (gig_id);
alter table public.contracts add constraint contracts_gig_id_unique unique (gig_id);

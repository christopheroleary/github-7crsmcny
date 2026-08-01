-- get_invoice(token) and get_day_sheet(token) are leftover functions
-- from before the invoice/setlist schema evolved and are now broken:
-- get_invoice references invoices.amount, which doesn't exist (line
-- items live in invoice_items.unit_amount_pence); get_day_sheet
-- references setlists.gig_id, which doesn't exist either (setlists
-- now live in a band's library and link to gigs via the gig_setlists
-- junction table). Neither is referenced anywhere in the frontend --
-- both would error if ever actually called. Unrelated to and not to
-- be confused with the current get_invoice_by_token/get_quote_by_token/
-- get_contract_by_token functions added for the public share pages.

drop function if exists public.get_invoice(uuid);
drop function if exists public.get_day_sheet(uuid);

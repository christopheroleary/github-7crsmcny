-- Backs the "Bill to: Another band" picker in GigInvoice.jsx. Deliberately
-- does NOT use is_admin() to see every band in the system, unlike almost
-- every other admin-privileged query in this app -- bands_read_all's own
-- can_view_band() check (created it / lead it / a member of it / played
-- one of its gigs) is exactly the right boundary here too: picking a band
-- as a bill-to target discloses that band's contact_email/contact_phone/
-- address on a public, unauthenticated share link (get_invoice_by_token),
-- to whoever holds the invoice link -- an admin managing many unrelated
-- bands company-wide should not be able to do that to a band they have no
-- actual connection to, any more than a non-admin leader could. If a
-- genuine cross-band billing relationship exists (a solo act subcontracted
-- via an agency, one act billing another), whoever is doing the billing
-- already has a real relationship to the band being billed (they created
-- it, lead it, are a member, or have played one of its gigs) -- which is
-- exactly the set this returns.
create or replace function public.get_billable_bands()
 returns table(id uuid, name text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select b.id, b.name
  from public.bands b
  where public.can_view_band(b.id)
  order by b.name;
$function$;

grant execute on function public.get_billable_bands() to authenticated;

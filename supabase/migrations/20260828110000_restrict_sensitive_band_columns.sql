-- Stops any musician who's ever done one gig for a band from reading its
-- bank details -- and, since the last migration, its Stripe Connect
-- account id too.
--
-- Same gap 20260826130000_restrict_sensitive_profile_columns.sql closed on
-- profiles, unnoticed here until now: bands RLS is row-level
-- (bands_read_all: admin, any leader, or anyone ever booked on one of the
-- band's gigs via can_view_band), but "see the row" has always meant "see
-- every column" -- including bank_name/bank_account_name/bank_sort_code/
-- bank_account_number and, as of yesterday, stripe_connect_account_id.
-- The account id alone can't move money without the platform's secret
-- key, but it's still needless exposure of internal Stripe plumbing to
-- anyone who's ever played one gig for the band.
--
-- Same fix shape as profiles: drop the blanket SELECT, hand back every
-- column that's safe to share broadly (which is nearly all of them --
-- contact/VAT/invoice-footer/branding fields are already meant to be
-- shown to clients on documents, and public_* fields are, by definition,
-- public), and gate the five sensitive ones behind a SECURITY DEFINER
-- function that checks the caller is actually admin or a leader of *that*
-- band, not just "can see the row at all".
--
-- stripe_connect_status is deliberately kept in the broad grant, mirroring
-- get_payment_details' own reasoning for profiles: it's a status, not an
-- identifier, and the UI needs it to decide what to show.

revoke select on public.bands from authenticated;

grant select (
  id, name, notes, created_at, contact_email, contact_phone, address,
  vat_number, invoice_notes, invoice_name,
  fee_split_singer_bonus_pct, fee_split_dj_pct, fee_split_roadie_pct,
  fee_split_owner_profit_pct, fee_split_captain_bonus_pct,
  created_by, doc_accent_colour, doc_secondary_colour, vat_rate,
  logo_url, website_url, social_links,
  public_slug, public_bio, public_genres, public_enabled,
  stripe_connect_status
) on public.bands to authenticated;

-- Left revoked, reachable only via the function below:
--   bank_name, bank_account_name, bank_sort_code, bank_account_number,
--   stripe_connect_account_id
--
-- UPDATE is deliberately untouched, same reasoning as the profiles
-- migration -- writing these is still a plain update, gated by the
-- existing bands_update_admin row policy (and, for the Connect columns,
-- protect_band_connect_fields on top of that).

create or replace function public.get_band_payment_details(p_band_id uuid)
returns table (
  bank_name text,
  bank_account_name text,
  bank_sort_code text,
  bank_account_number text,
  stripe_connect_account_id text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select b.bank_name, b.bank_account_name, b.bank_sort_code, b.bank_account_number,
         b.stripe_connect_account_id
  from public.bands b
  where b.id = p_band_id
    and (public.is_admin() or public.is_band_leader_of(p_band_id));
$$;

grant execute on function public.get_band_payment_details(uuid) to authenticated;

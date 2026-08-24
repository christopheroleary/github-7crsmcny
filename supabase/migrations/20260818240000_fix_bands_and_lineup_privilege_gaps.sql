-- SECURITY FIX: remaining privilege inversions, plus unconstrained self-write
-- on gig_lineup.
--
-- Companion to 20260818220000, which fixed this same inverted pattern on
-- profiles/profile_instruments/placeholder_musicians/placeholder_musician_
-- instruments. Two more tables carry it, and the bands one is the most
-- serious instance found anywhere in the schema.

-- ── 1. bands ────────────────────────────────────────────────────────────────
-- Previous policy:
--   using ((auth.role() = 'authenticated' and not is_band_leader())
--          or is_admin()
--          or (is_band_leader() and (is_band_leader_of(id) or created_by = auth.uid())))
--
-- public.bands holds bank_name, bank_account_name, bank_sort_code and
-- bank_account_number (they are read straight out of it by
-- get_invoice_by_token to render an invoice), alongside contact_email,
-- contact_phone, address and vat_number.
--
-- The blanket first clause therefore let ANY authenticated non-leader --
-- including a brand-new free signup with no band, no gig and no
-- relationship to anyone -- run
--
--   supabase.from('bands').select('*')
--
-- and read every band's bank details on the platform. No leaked link and no
-- token needed; signing up was sufficient. This is a strictly worse version
-- of the share-token exposure fixed in 20260818230000, which at least
-- required someone to have been sent a link.
create or replace function public.can_view_band(p_band_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select
    exists (select 1 from public.bands where id = p_band_id and created_by = auth.uid())
    or public.is_band_leader_of(p_band_id)
    -- A member of the band.
    or exists (
      select 1 from public.band_members bm
      where bm.band_id = p_band_id and bm.profile_id = auth.uid()
    )
    -- Booked on one of the band's gigs. Members legitimately need the band
    -- name and branding for gigs they are on, which is what the blanket
    -- clause had been covering.
    or exists (
      select 1 from public.gig_lineup gl
      join public.gigs g on g.id = gl.gig_id
      where g.band_id = p_band_id and gl.profile_id = auth.uid()
    );
$$;

drop policy if exists bands_read_all on public.bands;
create policy bands_read_all on public.bands for select to public
using ((select is_admin()) or can_view_band(id));

-- ── 2. band_members ─────────────────────────────────────────────────────────
-- Same inverted clause, and it exposed the full membership graph of every
-- band on the platform to any signed-up account.
drop policy if exists band_members_read_all on public.band_members;
create policy band_members_read_all on public.band_members for select to public
using ((select is_admin()) or profile_id = (select auth.uid()) or can_view_band(band_id));

-- ── 3. gig_lineup self-update was row-scoped but not column-scoped ──────────
-- gig_lineup_update_own reads:
--   using       (profile_id = auth.uid() or is_admin() or <band leader>)
--   with check  (profile_id = auth.uid() or is_admin() or <band leader>)
--
-- Both clauses only ever check WHO owns the row -- neither constrains WHICH
-- columns may change, and neither pins gig_id. So a musician on any single
-- gig could, from the browser console:
--
--   * .update({ gig_id: '<some other gig>' }) -- move their own lineup row
--     onto a gig they were never booked on. Both clauses still pass, since
--     profile_id is untouched. That grants is_on_gig() on the target gig,
--     which cascades into gigs_select, gig_requirements, gig_setlists,
--     setlists, setlist_items -- and, after 20260818220000 made profile
--     visibility depend on shared gigs, the phone/home_address/home GPS of
--     everyone else on that gig. Gig ids are uuids so they are not
--     enumerable, but anyone who has ever seen one (a past booking, a URL)
--     keeps it forever.
--   * .update({ fee_pence: 999999, is_captain: true }) -- rewrite their own
--     fee and mark themselves captain.
--
-- Stripe payouts read musician_claim_items, not this column, and those are
-- frozen once a claim leaves 'pending'/'rejected' -- so this is not a direct
-- route to money. It is still unauthorised write access to financial and
-- assignment data, and a read-escalation pivot.
--
-- The app only ever has a musician set `confirmed` on their own row
-- (GigDetailBandMember). vocal_role, is_captain and fee_pence are written
-- from the band-leader screens (GigRoster, GigFeeSplit). So: for a caller
-- who is neither admin nor a leader of the gig's band, revert every column
-- except `confirmed`. Mirrors protect_subscription_fields -- silently revert
-- rather than raise, so a legitimate confirm in the same statement still
-- succeeds.
create or replace function public.protect_gig_lineup_self_update()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_is_leader boolean;
begin
  select public.is_admin() or exists (
    select 1 from public.gigs g
    where g.id = old.gig_id and g.band_id is not null and public.is_band_leader_of(g.band_id)
  ) into v_is_leader;

  if v_is_leader or auth.role() = 'service_role' then
    return new;
  end if;

  -- Everything a musician does not own on their own row.
  new.gig_id             := old.gig_id;
  new.profile_id         := old.profile_id;
  new.placeholder_id     := old.placeholder_id;
  new.instrument_id      := old.instrument_id;
  new.fee_pence          := old.fee_pence;
  new.confirmed_fee_pence := old.confirmed_fee_pence;
  new.travel_cost_pence  := old.travel_cost_pence;
  -- travel_miles and lift_share are only ever written by TravelCalculator,
  -- a band-leader screen, and both feed the travel payment -- so they are
  -- not a musician's to set on their own row either.
  new.travel_miles       := old.travel_miles;
  new.lift_share         := old.lift_share;
  new.vocal_role         := old.vocal_role;
  new.is_captain         := old.is_captain;
  new.is_dj              := old.is_dj;
  new.is_roadie          := old.is_roadie;

  return new;
end;
$$;

drop trigger if exists gig_lineup_protect_self_update on public.gig_lineup;
-- Fires before the existing snapshot/notify triggers on this table so those
-- see the corrected row rather than the attempted one.
create trigger gig_lineup_protect_self_update
before update on public.gig_lineup
for each row execute function public.protect_gig_lineup_self_update();

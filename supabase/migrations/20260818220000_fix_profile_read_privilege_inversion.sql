-- SECURITY FIX: privilege inversion on profile-adjacent reads.
--
-- The previous policies all had this shape:
--
--   using ((auth.role() = 'authenticated' and not is_band_leader())
--          or is_admin()
--          or (is_band_leader() and can_view_profile(id)))
--
-- The intent was "band leaders are scoped to their own bands". The effect
-- was the opposite of least privilege: the first clause grants *every*
-- authenticated non-leader a blanket read of the entire table, so a plain
-- band member -- or anyone who simply signs up -- could run
--
--   supabase.from('profiles').select('*')
--
-- and retrieve every user on the platform, including phone, home_address,
-- and home_latitude/home_longitude (exact home coordinates), plus
-- stripe_customer_id and subscription_tier. Band leaders, the role the
-- policy was written to constrain, were in fact the *only* constrained
-- role.
--
-- Fix: drop the blanket clause entirely and scope every role through the
-- same can_view_profile()/can_view_placeholder() predicates, extended below
-- to cover the legitimate needs of ordinary members (people they share a
-- gig or a band with) that the blanket clause had been papering over.
--
-- Both helpers are security definer, so they bypass RLS internally and do
-- not recurse when called from a policy on the table they query -- the same
-- pattern these functions already rely on today.

-- ── Helper: who may see a real profile ──────────────────────────────────────
create or replace function public.can_view_profile(p_profile_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select
    -- Yourself.
    p_profile_id = auth.uid()
    -- Musicians who opted into the dep pool are discoverable -- but by band
    -- LEADERS only, since they are the ones who book deps. The original
    -- clause had no reference to the caller at all, so ticking
    -- "available for dep work" published that musician's phone, home_address
    -- and home_latitude/longitude to every authenticated account on the
    -- platform. Verified against live data: this clause alone accounted for
    -- 2 of the 5 profiles, 1 of 2 phones and 2 of 3 home addresses still
    -- reachable by an ordinary member after the blanket clause was removed.
    -- Band leaders keep full access, so DepFinderWizard's distance-from-venue
    -- calculation (which needs home_latitude) is unaffected.
    or (public.is_band_leader() and exists (
          select 1 from public.profiles where id = p_profile_id and available_for_dep_work = true))
    -- Someone in a band you lead.
    or exists (
      select 1 from public.band_members bm
      where bm.profile_id = p_profile_id and public.is_band_leader_of(bm.band_id)
    )
    -- Someone on a gig you lead.
    or exists (
      select 1 from public.gig_lineup gl
      join public.gigs g on g.id = gl.gig_id
      where gl.profile_id = p_profile_id and public.is_band_leader_of(g.band_id)
    )
    -- NEW -- someone booked on a gig you are also booked on. This is what
    -- ordinary members legitimately need (roster rows, day sheets) and was
    -- previously covered by the blanket clause.
    or exists (
      select 1
      from public.gig_lineup mine
      join public.gig_lineup theirs on theirs.gig_id = mine.gig_id
      where mine.profile_id = auth.uid()
        and theirs.profile_id = p_profile_id
    )
    -- NEW -- someone in a band you are also a member of.
    or exists (
      select 1
      from public.band_members mine
      join public.band_members theirs on theirs.band_id = mine.band_id
      where mine.profile_id = auth.uid()
        and theirs.profile_id = p_profile_id
    );
$$;

-- ── Helper: who may see a placeholder musician ──────────────────────────────
create or replace function public.can_view_placeholder(p_placeholder_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select
    exists (select 1 from public.placeholder_musicians where id = p_placeholder_id and created_by = auth.uid())
    or exists (
      select 1 from public.band_members bm
      where bm.placeholder_id = p_placeholder_id and public.is_band_leader_of(bm.band_id)
    )
    or exists (
      select 1 from public.gig_lineup gl
      join public.gigs g on g.id = gl.gig_id
      where gl.placeholder_id = p_placeholder_id and public.is_band_leader_of(g.band_id)
    )
    -- NEW -- a placeholder on a gig you are also booked on (placeholders
    -- carry contact details too, so they need the same treatment).
    or exists (
      select 1
      from public.gig_lineup mine
      join public.gig_lineup theirs on theirs.gig_id = mine.gig_id
      where mine.profile_id = auth.uid()
        and theirs.placeholder_id = p_placeholder_id
    )
    -- NEW -- a placeholder in a band you are also a member of.
    or exists (
      select 1
      from public.band_members mine
      join public.band_members theirs on theirs.band_id = mine.band_id
      where mine.profile_id = auth.uid()
        and theirs.placeholder_id = p_placeholder_id
    );
$$;

-- ── Policies: same predicate for every role, no blanket clause ──────────────
-- is_admin() is wrapped in (select ...) so the planner evaluates it ONCE per
-- query as an InitPlan rather than re-running it for every candidate row.
-- Supabase's own linter flags the un-wrapped form (auth_rls_initplan) and it
-- matters more the more rows the table holds. can_view_*(id) genuinely takes
-- the row as an argument, so it cannot be hoisted the same way.
drop policy if exists profiles_read_all on public.profiles;
create policy profiles_read_all on public.profiles for select to public
using ((select is_admin()) or can_view_profile(id));

drop policy if exists profile_instruments_read_all on public.profile_instruments;
create policy profile_instruments_read_all on public.profile_instruments for select to public
using ((select is_admin()) or can_view_profile(profile_id));

drop policy if exists placeholder_read on public.placeholder_musicians;
create policy placeholder_read on public.placeholder_musicians for select to public
using ((select is_admin()) or can_view_placeholder(id));

drop policy if exists ph_instr_read on public.placeholder_musician_instruments;
create policy ph_instr_read on public.placeholder_musician_instruments for select to public
using ((select is_admin()) or can_view_placeholder(placeholder_id));

-- NOTE -- public.songs carries the same inverted blanket clause, but is
-- deliberately left alone here. It holds no personal data (titles, keys,
-- tempos), and members legitimately need to read songs that appear on
-- setlists for gigs they are booked on -- scoping it correctly means
-- expressing that setlist-visibility rule, which is a behaviour change
-- rather than a straight security fix and should be verified against the
-- setlist screens before shipping. Tracked separately.

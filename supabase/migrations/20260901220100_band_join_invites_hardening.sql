-- Three lint fixes on the band_join_invites migration just applied,
-- mirroring existing conventions elsewhere in this schema rather than
-- introducing new ones:

-- 1. CREATE FUNCTION grants EXECUTE to PUBLIC by default, so `anon` could
-- call both RPCs even though only `authenticated` was explicitly granted --
-- exactly the gap 20260827100000_harden_function_execute_grants.sql closed
-- for a batch of other functions. accept_band_invite already no-ops for an
-- anonymous caller (auth.uid() is null), but get_band_invite_preview would
-- have let anyone probe arbitrary tokens for a band name + inviter name
-- with no session at all.
revoke execute on function public.get_band_invite_preview(uuid) from public;
revoke execute on function public.accept_band_invite(uuid) from public;

-- 2. auth_rls_initplan: wrap auth.uid() so it's evaluated once per
-- statement (InitPlan) rather than re-run per candidate row -- same fix
-- 20260827110000_rls_initplan_and_fk_indexes.sql already applied elsewhere.
drop policy if exists band_join_invites_insert on public.band_join_invites;
create policy band_join_invites_insert on public.band_join_invites
for insert to public
with check (
  (created_by = (select auth.uid()) or (select is_admin()))
  and ((select is_admin()) or is_band_leader_of(band_id))
  and (
    select count(*) from public.band_join_invites existing
    where existing.band_id = band_id
      and existing.created_at > now() - interval '24 hours'
  ) < 20
);

-- 3. unindexed_foreign_keys on created_by/used_by (band_id already indexed
-- in the previous migration).
create index band_join_invites_created_by_idx on public.band_join_invites(created_by);
create index band_join_invites_used_by_idx on public.band_join_invites(used_by);

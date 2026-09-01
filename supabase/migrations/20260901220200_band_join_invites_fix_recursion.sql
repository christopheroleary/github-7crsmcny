-- The rate-limit subquery in band_join_invites_insert queried
-- band_join_invites directly from inside that table's own WITH CHECK,
-- which hit "infinite recursion detected in policy for relation
-- band_join_invites" the moment it actually ran (caught live, not just by
-- inspection). Same fix this codebase already uses for exactly this shape
-- of problem: move the count into a SECURITY DEFINER helper, which bypasses
-- RLS internally and doesn't recurse when called from a policy on the table
-- it queries (see can_view_profile/can_view_placeholder,
-- 20260818220000_fix_profile_read_privilege_inversion.sql).
create or replace function public.band_invite_rate_ok(p_band_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select count(*) < 20
  from public.band_join_invites
  where band_id = p_band_id
    and created_at > now() - interval '24 hours';
$$;

drop policy if exists band_join_invites_insert on public.band_join_invites;
create policy band_join_invites_insert on public.band_join_invites
for insert to public
with check (
  (created_by = (select auth.uid()) or (select is_admin()))
  and ((select is_admin()) or is_band_leader_of(band_id))
  and public.band_invite_rate_ok(band_id)
);

revoke execute on function public.band_invite_rate_ok(uuid) from public;

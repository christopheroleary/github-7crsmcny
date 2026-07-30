-- Without this, a band leader's self-created band fails on INSERT ... RETURNING
-- (which the Supabase client always does): the SELECT policy checks
-- is_band_leader_of(id), but that row is only granted by an AFTER INSERT
-- trigger that runs after RETURNING's visibility check. created_by, set via
-- column default, is visible on the same row immediately.
alter table public.bands add column created_by uuid references public.profiles(id) default auth.uid();

drop policy if exists bands_read_all on public.bands;
create policy bands_read_all on public.bands for select to public
using (
  (auth.role() = 'authenticated' and not is_band_leader())
  or is_admin()
  or (is_band_leader() and (is_band_leader_of(id) or created_by = auth.uid()))
);

drop policy if exists bands_update_admin on public.bands;
create policy bands_update_admin on public.bands for update to public
using (is_admin() or is_band_leader_of(id) or created_by = auth.uid());

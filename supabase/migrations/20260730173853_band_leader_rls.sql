-- bands
drop policy if exists bands_read_all on public.bands;
create policy bands_read_all on public.bands for select to public
using ((auth.role() = 'authenticated' and not is_band_leader()) or is_admin() or (is_band_leader() and is_band_leader_of(id)));

drop policy if exists bands_insert_admin on public.bands;
create policy bands_insert_admin on public.bands for insert to public
with check (is_admin() or is_band_leader());

drop policy if exists bands_update_admin on public.bands;
create policy bands_update_admin on public.bands for update to public
using (is_admin() or is_band_leader_of(id));

-- band_members
drop policy if exists band_members_read_all on public.band_members;
create policy band_members_read_all on public.band_members for select to public
using ((auth.role() = 'authenticated' and not is_band_leader()) or is_admin() or (is_band_leader() and is_band_leader_of(band_id)));

drop policy if exists band_members_insert_admin on public.band_members;
create policy band_members_insert_admin on public.band_members for insert to public
with check (is_admin() or is_band_leader_of(band_id));

drop policy if exists band_members_delete_admin on public.band_members;
create policy band_members_delete_admin on public.band_members for delete to public
using (is_admin() or is_band_leader_of(band_id));

-- gigs
drop policy if exists gigs_select on public.gigs;
create policy gigs_select on public.gigs for select to public
using (is_admin() or is_on_gig(id) or (band_id is not null and is_band_leader_of(band_id)));

drop policy if exists gigs_insert_admin on public.gigs;
create policy gigs_insert_admin on public.gigs for insert to public
with check (is_admin() or (band_id is not null and is_band_leader_of(band_id)));

drop policy if exists gigs_update_admin on public.gigs;
create policy gigs_update_admin on public.gigs for update to public
using (is_admin() or (band_id is not null and is_band_leader_of(band_id)))
with check (is_admin() or (band_id is not null and is_band_leader_of(band_id)));

drop policy if exists gigs_delete_admin on public.gigs;
create policy gigs_delete_admin on public.gigs for delete to public
using (is_admin() or (band_id is not null and is_band_leader_of(band_id)));

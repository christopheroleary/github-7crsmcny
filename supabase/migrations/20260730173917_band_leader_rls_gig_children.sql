-- gig_lineup
drop policy if exists gig_lineup_select on public.gig_lineup;
create policy gig_lineup_select on public.gig_lineup for select to public
using (
  is_admin() or profile_id = auth.uid() or is_on_gig(gig_id)
  or exists (select 1 from gigs g where g.id = gig_lineup.gig_id and is_band_leader_of(g.band_id))
);

drop policy if exists gig_lineup_insert_admin on public.gig_lineup;
create policy gig_lineup_insert_admin on public.gig_lineup for insert to public
with check (
  is_admin()
  or exists (select 1 from gigs g where g.id = gig_lineup.gig_id and is_band_leader_of(g.band_id))
);

drop policy if exists gig_lineup_delete_admin on public.gig_lineup;
create policy gig_lineup_delete_admin on public.gig_lineup for delete to public
using (
  is_admin()
  or exists (select 1 from gigs g where g.id = gig_lineup.gig_id and is_band_leader_of(g.band_id))
);

drop policy if exists gig_lineup_update_own on public.gig_lineup;
create policy gig_lineup_update_own on public.gig_lineup for update to public
using (
  profile_id = auth.uid() or is_admin()
  or exists (select 1 from gigs g where g.id = gig_lineup.gig_id and is_band_leader_of(g.band_id))
)
with check (
  profile_id = auth.uid() or is_admin()
  or exists (select 1 from gigs g where g.id = gig_lineup.gig_id and is_band_leader_of(g.band_id))
);

-- gig_requirements
drop policy if exists gig_requirements_select on public.gig_requirements;
create policy gig_requirements_select on public.gig_requirements for select to public
using (
  is_admin()
  or exists (select 1 from gig_lineup where gig_lineup.gig_id = gig_requirements.gig_id and gig_lineup.profile_id = auth.uid())
  or exists (select 1 from gigs g where g.id = gig_requirements.gig_id and is_band_leader_of(g.band_id))
);

drop policy if exists gig_requirements_insert_admin on public.gig_requirements;
create policy gig_requirements_insert_admin on public.gig_requirements for insert to public
with check (
  is_admin()
  or exists (select 1 from gigs g where g.id = gig_requirements.gig_id and is_band_leader_of(g.band_id))
);

drop policy if exists gig_requirements_update_admin on public.gig_requirements;
create policy gig_requirements_update_admin on public.gig_requirements for update to public
using (
  is_admin()
  or exists (select 1 from gigs g where g.id = gig_requirements.gig_id and is_band_leader_of(g.band_id))
);

drop policy if exists gig_requirements_delete_admin on public.gig_requirements;
create policy gig_requirements_delete_admin on public.gig_requirements for delete to public
using (
  is_admin()
  or exists (select 1 from gigs g where g.id = gig_requirements.gig_id and is_band_leader_of(g.band_id))
);

-- gig_setlists
drop policy if exists gig_setlists_select on public.gig_setlists;
create policy gig_setlists_select on public.gig_setlists for select to public
using (
  is_admin()
  or exists (select 1 from gig_lineup where gig_lineup.gig_id = gig_setlists.gig_id and gig_lineup.profile_id = auth.uid())
  or exists (select 1 from gigs g where g.id = gig_setlists.gig_id and is_band_leader_of(g.band_id))
);

drop policy if exists gig_setlists_insert_admin on public.gig_setlists;
create policy gig_setlists_insert_admin on public.gig_setlists for insert to public
with check (
  is_admin()
  or exists (select 1 from gigs g where g.id = gig_setlists.gig_id and is_band_leader_of(g.band_id))
);

drop policy if exists gig_setlists_delete_admin on public.gig_setlists;
create policy gig_setlists_delete_admin on public.gig_setlists for delete to public
using (
  is_admin()
  or exists (select 1 from gigs g where g.id = gig_setlists.gig_id and is_band_leader_of(g.band_id))
);

-- setlists
drop policy if exists setlists_select on public.setlists;
create policy setlists_select on public.setlists for select to public
using (
  is_admin()
  or exists (select 1 from gig_setlists gs join gig_lineup gl on gl.gig_id = gs.gig_id where gs.setlist_id = setlists.id and gl.profile_id = auth.uid())
  or (band_id is not null and is_band_leader_of(band_id))
);

drop policy if exists setlists_insert_admin on public.setlists;
create policy setlists_insert_admin on public.setlists for insert to public
with check (is_admin() or (band_id is not null and is_band_leader_of(band_id)));

drop policy if exists setlists_update_admin on public.setlists;
create policy setlists_update_admin on public.setlists for update to public
using (is_admin() or (band_id is not null and is_band_leader_of(band_id)));

drop policy if exists setlists_delete_admin on public.setlists;
create policy setlists_delete_admin on public.setlists for delete to public
using (is_admin() or (band_id is not null and is_band_leader_of(band_id)));

-- setlist_items
drop policy if exists setlist_items_select on public.setlist_items;
create policy setlist_items_select on public.setlist_items for select to public
using (
  is_admin()
  or exists (
    select 1 from setlists sl join gig_setlists gs on gs.setlist_id = sl.id join gig_lineup gl on gl.gig_id = gs.gig_id
    where sl.id = setlist_items.setlist_id and gl.profile_id = auth.uid()
  )
  or exists (select 1 from setlists sl where sl.id = setlist_items.setlist_id and sl.band_id is not null and is_band_leader_of(sl.band_id))
);

drop policy if exists setlist_items_insert_admin on public.setlist_items;
create policy setlist_items_insert_admin on public.setlist_items for insert to public
with check (
  is_admin()
  or exists (select 1 from setlists sl where sl.id = setlist_items.setlist_id and sl.band_id is not null and is_band_leader_of(sl.band_id))
);

drop policy if exists setlist_items_update_admin on public.setlist_items;
create policy setlist_items_update_admin on public.setlist_items for update to public
using (
  is_admin()
  or exists (select 1 from setlists sl where sl.id = setlist_items.setlist_id and sl.band_id is not null and is_band_leader_of(sl.band_id))
);

drop policy if exists setlist_items_delete_admin on public.setlist_items;
create policy setlist_items_delete_admin on public.setlist_items for delete to public
using (
  is_admin()
  or exists (select 1 from setlists sl where sl.id = setlist_items.setlist_id and sl.band_id is not null and is_band_leader_of(sl.band_id))
);

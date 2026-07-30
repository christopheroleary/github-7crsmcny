-- profiles
drop policy if exists profiles_read_all on public.profiles;
create policy profiles_read_all on public.profiles for select to public
using ((auth.role() = 'authenticated' and not is_band_leader()) or is_admin() or (is_band_leader() and can_view_profile(id)));

-- profile_instruments
drop policy if exists profile_instruments_read_all on public.profile_instruments;
create policy profile_instruments_read_all on public.profile_instruments for select to public
using ((auth.role() = 'authenticated' and not is_band_leader()) or is_admin() or (is_band_leader() and can_view_profile(profile_id)));

-- venues
drop policy if exists venues_select on public.venues;
create policy venues_select on public.venues for select to public
using (
  is_admin()
  or exists (select 1 from gigs g join gig_lineup gl on gl.gig_id = g.id where g.venue_id = venues.id and gl.profile_id = auth.uid())
  or created_by = auth.uid()
  or exists (select 1 from gigs g where g.venue_id = venues.id and is_band_leader_of(g.band_id))
);

drop policy if exists venues_insert_admin on public.venues;
create policy venues_insert_admin on public.venues for insert to public
with check (is_admin() or (is_band_leader() and created_by = auth.uid()));

drop policy if exists venues_update_admin on public.venues;
create policy venues_update_admin on public.venues for update to public
using (is_admin() or created_by = auth.uid());

drop policy if exists venues_delete_admin on public.venues;
create policy venues_delete_admin on public.venues for delete to public
using (is_admin() or created_by = auth.uid());

-- clients (was a single ALL policy, split for finer control)
drop policy if exists clients_admin_only on public.clients;

create policy clients_select on public.clients for select to public
using (
  is_admin()
  or created_by = auth.uid()
  or exists (select 1 from gigs g where g.client_id = clients.id and is_band_leader_of(g.band_id))
);

create policy clients_insert on public.clients for insert to public
with check (is_admin() or (is_band_leader() and created_by = auth.uid()));

create policy clients_update on public.clients for update to public
using (is_admin() or created_by = auth.uid());

create policy clients_delete on public.clients for delete to public
using (is_admin() or created_by = auth.uid());

-- songs
drop policy if exists songs_read_all on public.songs;
create policy songs_read_all on public.songs for select to public
using ((auth.role() = 'authenticated' and not is_band_leader()) or is_admin() or (is_band_leader() and (created_by = auth.uid() or is_public)));

drop policy if exists songs_insert_admin on public.songs;
create policy songs_insert_admin on public.songs for insert to public
with check (is_admin() or (is_band_leader() and created_by = auth.uid()));

drop policy if exists songs_update_admin on public.songs;
create policy songs_update_admin on public.songs for update to public
using (is_admin() or (is_band_leader() and created_by = auth.uid()));

drop policy if exists songs_delete_admin on public.songs;
create policy songs_delete_admin on public.songs for delete to public
using (is_admin() or (is_band_leader() and created_by = auth.uid()));

-- placeholder_musicians
drop policy if exists placeholder_read on public.placeholder_musicians;
create policy placeholder_read on public.placeholder_musicians for select to public
using ((auth.role() = 'authenticated' and not is_band_leader()) or is_admin() or (is_band_leader() and can_view_placeholder(id)));

drop policy if exists placeholder_write_admin on public.placeholder_musicians;
create policy placeholder_write_admin on public.placeholder_musicians for insert to public
with check (is_admin() or (is_band_leader() and created_by = auth.uid()));

drop policy if exists placeholder_update_admin on public.placeholder_musicians;
create policy placeholder_update_admin on public.placeholder_musicians for update to public
using (is_admin() or (is_band_leader() and created_by = auth.uid()));

drop policy if exists placeholder_delete_admin on public.placeholder_musicians;
create policy placeholder_delete_admin on public.placeholder_musicians for delete to public
using (is_admin() or (is_band_leader() and created_by = auth.uid()));

-- placeholder_musician_instruments
drop policy if exists ph_instr_read on public.placeholder_musician_instruments;
create policy ph_instr_read on public.placeholder_musician_instruments for select to public
using ((auth.role() = 'authenticated' and not is_band_leader()) or is_admin() or (is_band_leader() and can_view_placeholder(placeholder_id)));

drop policy if exists ph_instr_write on public.placeholder_musician_instruments;
create policy ph_instr_write on public.placeholder_musician_instruments for insert to public
with check (
  is_admin()
  or (is_band_leader() and exists (select 1 from placeholder_musicians pm where pm.id = placeholder_musician_instruments.placeholder_id and pm.created_by = auth.uid()))
);

drop policy if exists ph_instr_delete on public.placeholder_musician_instruments;
create policy ph_instr_delete on public.placeholder_musician_instruments for delete to public
using (
  is_admin()
  or (is_band_leader() and exists (select 1 from placeholder_musicians pm where pm.id = placeholder_musician_instruments.placeholder_id and pm.created_by = auth.uid()))
);

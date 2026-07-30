-- Same fix as the earlier placeholder widening: co-leaders of the same band
-- could see a venue/client/song their band uses but couldn't edit it unless
-- they personally created it. Now any leader of a band linked to the row
-- (via a gig, or via a setlist for songs) can edit it too. Delete stays
-- creator-only across all three — removing a shared resource one co-leader
-- didn't create is left as an admin action for safety.

drop policy if exists venues_update_admin on public.venues;
create policy venues_update_admin on public.venues for update to public
using (
  is_admin()
  or created_by = auth.uid()
  or exists (select 1 from gigs g where g.venue_id = venues.id and is_band_leader_of(g.band_id))
);

drop policy if exists clients_update on public.clients;
create policy clients_update on public.clients for update to public
using (
  is_admin()
  or created_by = auth.uid()
  or exists (select 1 from gigs g where g.client_id = clients.id and is_band_leader_of(g.band_id))
);

drop policy if exists songs_update_admin on public.songs;
create policy songs_update_admin on public.songs for update to public
using (
  is_admin()
  or (is_band_leader() and (
    created_by = auth.uid()
    or exists (
      select 1 from setlist_items si
      join setlists sl on sl.id = si.setlist_id
      where si.song_id = songs.id and sl.band_id is not null and is_band_leader_of(sl.band_id)
    )
  ))
);

-- A band leader could see the setlist_items for their own band's setlists,
-- but not the underlying song rows admin added (unless admin separately
-- marked them public) — the embedded song came back null, hiding titles/
-- lyrics and crashing the edit form. Songs used in a leader's own band's
-- setlist are now visible/editable regardless of who created them or
-- whether they're public — matches the same pattern already used for
-- venues/clients/placeholders.

drop policy if exists songs_read_all on public.songs;
create policy songs_read_all on public.songs for select to public
using (
  (auth.role() = 'authenticated' and not is_band_leader())
  or is_admin()
  or (is_band_leader() and (
    created_by = auth.uid()
    or is_public
    or exists (
      select 1 from setlist_items si join setlists sl on sl.id = si.setlist_id
      where si.song_id = songs.id and sl.band_id is not null and is_band_leader_of(sl.band_id)
    )
  ))
);

drop policy if exists songs_update_admin on public.songs;
create policy songs_update_admin on public.songs for update to public
using (
  is_admin()
  or (is_band_leader() and (
    created_by = auth.uid()
    or exists (
      select 1 from setlist_items si join setlists sl on sl.id = si.setlist_id
      where si.song_id = songs.id and sl.band_id is not null and is_band_leader_of(sl.band_id)
    )
  ))
);

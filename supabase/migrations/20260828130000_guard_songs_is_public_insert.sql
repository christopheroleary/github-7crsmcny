-- Same class of gap as the bands Connect fields: songs_guard_is_public only
-- fires BEFORE UPDATE, but songs_insert_admin's WITH CHECK lets any band
-- leader insert a new song (created_by = self) with no column restriction.
-- is_public defaults to false but isn't forced -- confirmed live that a
-- non-admin leader could `.insert({ title: 'x', is_public: true, created_by:
-- self })` directly, self-publishing straight into the shared library every
-- other leader searches (songs_read_all treats is_public as "visible to
-- every leader, not just the creator or bands with it on a setlist") --
-- exactly what prevent_non_admin_public_song_change already exists to
-- gate on UPDATE. Extends the same function to also fire BEFORE INSERT.
create trigger songs_guard_is_public_insert
  before insert on public.songs
  for each row execute function public.prevent_non_admin_public_song_change();

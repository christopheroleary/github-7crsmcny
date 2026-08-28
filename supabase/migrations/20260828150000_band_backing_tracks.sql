-- Turns the dead backing_tracks table (unused by any frontend code, and
-- carrying a too-broad "any signed-in user can write any row" RLS policy
-- found during a full-schema RLS audit) into the real feature: a band's
-- own MP3 backing track for a song on their setlist, private to that band
-- -- the same song can have a different backing track per band, and one
-- band's upload is invisible to another band even if they both play it.

alter table public.backing_tracks
  add column band_id uuid references public.bands(id) on delete cascade,
  add column uploaded_by uuid references public.profiles(id),
  add column duration_seconds numeric;

-- band_id wasn't nullable=false at add-column time (a not-null column needs
-- a default or an empty table -- this one qualifies, but keeping the ALTER
-- ADD COLUMN and the NOT NULL as separate statements is the standard-safe
-- pattern regardless of table size).
alter table public.backing_tracks alter column band_id set not null;

create index if not exists backing_tracks_band_id_idx on public.backing_tracks (band_id);

-- file_url is now a storage *path* (the bucket below is private), not a
-- public URL -- no column rename needed, just a change in what it holds.
comment on column public.backing_tracks.file_url is
  'Path within the backing-tracks storage bucket (private), not a public URL -- read via a signed URL.';

drop policy if exists "backing_tracks_all_signed_in" on public.backing_tracks;

-- Same broad-read/narrow-write split as bands itself: anyone who can see
-- the band at all (can_view_band -- admin, leader, or anyone ever booked
-- on one of its gigs) can listen, but only a leader or admin decides
-- what's in the band's library.
create policy "backing_tracks_select" on public.backing_tracks for select
using (is_admin() or can_view_band(band_id));

create policy "backing_tracks_insert" on public.backing_tracks for insert
with check (is_admin() or is_band_leader_of(band_id));

create policy "backing_tracks_update" on public.backing_tracks for update
using (is_admin() or is_band_leader_of(band_id));

create policy "backing_tracks_delete" on public.backing_tracks for delete
using (is_admin() or is_band_leader_of(band_id));

-- Storage: a new PRIVATE bucket (unlike band-logos/profile-pictures, which
-- are public -- these files are explicitly meant to stay inside one band).
-- Same storage.foldername(name)[1]::uuid-as-band_id path convention as
-- band-logos (20260810140000_add_band_logo.sql), with the same
-- broad-read/narrow-write split as the table policies above.
insert into storage.buckets (id, name, public)
values ('backing-tracks', 'backing-tracks', false)
on conflict (id) do nothing;

create policy "backing_tracks_storage_read" on storage.objects for select
using (
  bucket_id = 'backing-tracks'
  and (is_admin() or can_view_band(((storage.foldername(name))[1])::uuid))
);

create policy "backing_tracks_storage_insert" on storage.objects for insert
with check (
  bucket_id = 'backing-tracks'
  and (is_admin() or is_band_leader_of(((storage.foldername(name))[1])::uuid))
);

create policy "backing_tracks_storage_update" on storage.objects for update
using (
  bucket_id = 'backing-tracks'
  and (is_admin() or is_band_leader_of(((storage.foldername(name))[1])::uuid))
);

create policy "backing_tracks_storage_delete" on storage.objects for delete
using (
  bucket_id = 'backing-tracks'
  and (is_admin() or is_band_leader_of(((storage.foldername(name))[1])::uuid))
);

-- Server-side enforcement to match the client-side check -- same
-- defense-in-depth pattern as 20260810144930_restrict_band_logo_uploads.sql.
-- 30MB comfortably covers a 5-minute track at a high bitrate.
update storage.buckets
set file_size_limit = 30 * 1024 * 1024,
    allowed_mime_types = array['audio/mpeg']
where id = 'backing-tracks';

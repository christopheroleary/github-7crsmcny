-- Profile picture for any user -- same reasoning as the band logo: upload-
-- based rather than an external URL (no third-party control over what
-- renders, no IP leak to a hotlinked host, no silent breakage if that host
-- disappears). Resized/heavily compressed client-side before upload (see
-- src/utils/resizeImage.js) to a small avatar size -- this is shown at
-- thumbnail size almost everywhere it's used (roster rows, day sheets, the
-- header), so there's no reason to store anything larger than that.
alter table public.profiles add column avatar_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-pictures', 'profile-pictures', true, 2 * 1024 * 1024, array['image/webp'])
on conflict (id) do nothing;

-- Public read (shown across the roster/day sheets to everyone on a gig,
-- and the size/mime restrictions above already keep this bucket cheap to
-- serve), write scoped to the profile's own owner or an admin. Object
-- paths are always "{user_id}/avatar.webp", so the profile a write targets
-- is just the first path segment -- mirrors the band-logos bucket exactly.
create policy "profile_pictures_read" on storage.objects for select
using (bucket_id = 'profile-pictures');

create policy "profile_pictures_insert" on storage.objects for insert
with check (
  bucket_id = 'profile-pictures'
  and (is_admin() or auth.uid() = (storage.foldername(name))[1]::uuid)
);

create policy "profile_pictures_update" on storage.objects for update
using (
  bucket_id = 'profile-pictures'
  and (is_admin() or auth.uid() = (storage.foldername(name))[1]::uuid)
);

create policy "profile_pictures_delete" on storage.objects for delete
using (
  bucket_id = 'profile-pictures'
  and (is_admin() or auth.uid() = (storage.foldername(name))[1]::uuid)
);

-- Photos musicians take at a gig, shared with the band leader/admin so
-- they can pull together a social media post afterwards. Deliberately
-- photos-only for now (video is real storage cost, deferred until there's
-- a sense of actual usage) and auto-deleted after a retention window (see
-- the next migration) rather than kept forever, since there's no legal
-- reason to keep these the way receipts/tax records are.

create table public.gig_photos (
  id uuid primary key default gen_random_uuid(),
  gig_id uuid not null references public.gigs(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id) on delete cascade,

  storage_path text not null,
  byte_size integer,

  -- A short optional note from the uploader ("soundcheck chaos") --
  -- separate from the AI-drafted social caption, which lives in its own
  -- table (gig_photo_captions, next migration) since one caption can
  -- describe several photos at once.
  caption text,

  -- Soft-hide, not delete, is the band leader's moderation tool -- see
  -- gig_photos_delete below for why true delete stays owner/admin-only.
  hidden_at timestamptz,
  hidden_by uuid references public.profiles(id),

  -- Set by set_gig_photo_expiry() below, not a plain column default --
  -- needs to read the admin-adjustable retention window from
  -- app_settings, which a column default can't do.
  expires_at timestamptz not null,

  created_at timestamptz not null default now()
);

create index gig_photos_gig_id_created_at_idx on public.gig_photos (gig_id, created_at);
create index gig_photos_expires_at_idx on public.gig_photos (expires_at);

alter table public.gig_photos enable row level security;

-- Same breadth as gig_messages_select -- anyone on the roster (confirmed
-- or not), this gig's band leader, or an admin can VIEW the gallery.
create policy "gig_photos_select" on public.gig_photos for select
using (
  is_admin()
  or is_band_leader_of((select band_id from public.gigs where id = gig_id))
  or is_on_gig(gig_id)
);

-- Stricter than gig_messages_insert on purpose: uploading requires an
-- actually CONFIRMED roster row, not just being on the roster at all --
-- "musicians who were at the gig", not "anyone ever invited". Don't
-- loosen this to match gig_messages_insert without reconsidering that.
create policy "gig_photos_insert" on public.gig_photos for insert
with check (
  uploaded_by = auth.uid()
  and (
    is_admin()
    or is_band_leader_of((select band_id from public.gigs where id = gig_id))
    or exists (
      select 1 from public.gig_lineup
      where gig_id = gig_photos.gig_id and profile_id = auth.uid() and confirmed = true
    )
  )
);

-- Deliberately uploader-or-admin ONLY -- not extended to band leaders.
-- Storage's own delete policy below can only ever let the uploader's own
-- folder or an admin remove the underlying object; if a leader could
-- delete someone ELSE's row here, the storage object would be orphaned
-- with no gig_photos row left for the retention sweep to ever find and
-- clean up. Leaders moderate via hidden_at instead (gig_photos_update),
-- which never touches Storage at all.
create policy "gig_photos_delete" on public.gig_photos for delete
using (uploaded_by = auth.uid() or is_admin());

-- Covers both the hide/unhide toggle (leader/admin) and the optional
-- caption note (owner) -- one policy, since it's a plain column update
-- either way, not a full-row replace.
create policy "gig_photos_update" on public.gig_photos for update
using (
  uploaded_by = auth.uid()
  or is_admin()
  or is_band_leader_of((select band_id from public.gigs where id = gig_id))
)
with check (
  uploaded_by = auth.uid()
  or is_admin()
  or is_band_leader_of((select band_id from public.gigs where id = gig_id))
);

grant select, insert, update, delete on public.gig_photos to authenticated;
-- cleanup-expired-gig-photos (service role) reads expired rows and
-- deletes them -- see the retention-sweep migration.
grant select, delete on public.gig_photos to service_role;

-- ── Notification fan-out marker ───────────────────────────────────────────────
-- Deliberately NOT a trigger directly on gig_photos: a single upload can be
-- several photos, and a per-row trigger would fire one notification/push
-- per photo -- a 10-photo upload would spam 10. The client uploads every
-- photo first, then inserts exactly ONE row here at the end of the batch,
-- so notify_admin_webhook (attached below) fires exactly once per upload
-- session no matter how many photos were in it. Write-only -- nothing in
-- the UI ever reads this table back, it exists purely to fan out one
-- notification event, same invariant every other notify-admin branch
-- already relies on (one DB row = one notification).
create table public.gig_photo_batches (
  id uuid primary key default gen_random_uuid(),
  gig_id uuid not null references public.gigs(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id) on delete cascade,
  photo_count integer not null check (photo_count > 0),
  photo_ids uuid[] not null,
  created_at timestamptz not null default now()
);

alter table public.gig_photo_batches enable row level security;

create policy "gig_photo_batches_insert" on public.gig_photo_batches for insert
with check (
  uploaded_by = auth.uid()
  and (
    is_admin()
    or is_band_leader_of((select band_id from public.gigs where id = gig_id))
    or exists (
      select 1 from public.gig_lineup
      where gig_id = gig_photo_batches.gig_id and profile_id = auth.uid() and confirmed = true
    )
  )
);

grant insert on public.gig_photo_batches to authenticated;

-- The existing generic trigger (20260826160000_notify_admin_vault_secret.sql)
-- -- zero new webhook plumbing needed. notify-admin/index.ts gets a new
-- `table === 'gig_photo_batches'` branch to actually act on this.
create trigger notify_admin_gig_photo_batch
  after insert on public.gig_photo_batches
  for each row execute function public.notify_admin_webhook();

-- ── Public storage bucket ─────────────────────────────────────────────────────
-- public = true, unlike receipts -- these are meant to be shared/reused for
-- social posts, same reasoning as profile-pictures/band-logos, so no
-- signed-URL machinery is needed. webp/jpeg/png allowed from day one
-- (learned from the avatar bucket's original webp-only limit breaking on
-- iOS Safari's silent PNG fallback -- see 20260815020000_widen_avatar_logo
-- _bucket_mime_types.sql). 8MB is a generous server-side backstop; the real
-- size target is enforced client-side via resizeImageFile before upload.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gig-photos', 'gig-photos', true, 8 * 1024 * 1024, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

-- Object paths are "{uploader_profile_id}/{gig_id}-{uuid}.webp" -- reuses
-- the exact existing Storage RLS idiom (first path segment = auth.uid())
-- used by every other bucket in this app, rather than inventing a new one
-- keyed on gig_id. Per-gig gallery listing is entirely DB-driven (select
-- from gig_photos where gig_id = X), never by listing the bucket, so
-- photos not being grouped by gig IN the bucket has no functional effect.
create policy "gig_photos_storage_read" on storage.objects for select
using (bucket_id = 'gig-photos');

create policy "gig_photos_storage_insert" on storage.objects for insert
with check (
  bucket_id = 'gig-photos'
  and (is_admin() or auth.uid() = (storage.foldername(name))[1]::uuid)
);

-- No update policy -- photos are replace-by-delete-and-reupload, never
-- overwritten in place (unlike the avatar bucket's fixed one-path-per-user
-- convention).
create policy "gig_photos_storage_delete" on storage.objects for delete
using (
  bucket_id = 'gig-photos'
  and (is_admin() or auth.uid() = (storage.foldername(name))[1]::uuid)
);

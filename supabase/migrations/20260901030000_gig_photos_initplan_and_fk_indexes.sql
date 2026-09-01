-- Same fix as 20260827110000_rls_initplan_and_fk_indexes.sql, applied to
-- the gig-photos tables just added: wrap direct auth.uid() calls in RLS
-- policies as (select auth.uid()) so Postgres caches the value once per
-- query instead of re-evaluating it per row, plus indexes for the new
-- foreign keys the advisor flagged (uploaded_by/hidden_by/requested_by
-- are genuinely queried -- e.g. "my own uploads", "who hid this").

alter policy "gig_photos_insert" on public.gig_photos
with check (
  uploaded_by = (select auth.uid())
  and (
    is_admin()
    or is_band_leader_of((select band_id from public.gigs where id = gig_id))
    or exists (
      select 1 from public.gig_lineup
      where gig_id = gig_photos.gig_id and profile_id = (select auth.uid()) and confirmed = true
    )
  )
);

alter policy "gig_photos_delete" on public.gig_photos
using (uploaded_by = (select auth.uid()) or is_admin());

alter policy "gig_photos_update" on public.gig_photos
using (
  uploaded_by = (select auth.uid())
  or is_admin()
  or is_band_leader_of((select band_id from public.gigs where id = gig_id))
)
with check (
  uploaded_by = (select auth.uid())
  or is_admin()
  or is_band_leader_of((select band_id from public.gigs where id = gig_id))
);

alter policy "gig_photo_batches_insert" on public.gig_photo_batches
with check (
  uploaded_by = (select auth.uid())
  and (
    is_admin()
    or is_band_leader_of((select band_id from public.gigs where id = gig_id))
    or exists (
      select 1 from public.gig_lineup
      where gig_id = gig_photo_batches.gig_id and profile_id = (select auth.uid()) and confirmed = true
    )
  )
);

alter policy "gig_photo_captions_insert" on public.gig_photo_captions
with check (
  requested_by = (select auth.uid())
  and (is_admin() or is_band_leader_of((select band_id from public.gigs where id = gig_id)))
);

create index gig_photos_uploaded_by_idx on public.gig_photos (uploaded_by);
create index gig_photos_hidden_by_idx on public.gig_photos (hidden_by) where hidden_by is not null;
create index gig_photo_batches_gig_id_idx on public.gig_photo_batches (gig_id);
create index gig_photo_batches_uploaded_by_idx on public.gig_photo_batches (uploaded_by);
create index gig_photo_captions_requested_by_idx on public.gig_photo_captions (requested_by);

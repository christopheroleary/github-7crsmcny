-- Let a claimant read their own dep-invoice attachment.
--
-- dep-invoices storage RLS previously only let the band leader/admin who
-- uploaded a placeholder claim's attachment see it -- the musician the
-- invoice/claim is actually about had no read access to their own file.
-- Scoped narrowly: only the exact object that's genuinely referenced by a
-- claim belonging to the caller, not a broad "any claimant sees any
-- attachment" opening.
alter policy "dep_invoices_storage_read" on storage.objects
using (
  bucket_id = 'dep-invoices'
  and (
    is_admin()
    or is_band_leader_of((storage.foldername(name))[1]::uuid)
    or exists (
      select 1 from musician_claims c
      where c.attachment_path = objects.name
        and c.profile_id = (select auth.uid())
    )
  )
);

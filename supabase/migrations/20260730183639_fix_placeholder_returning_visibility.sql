-- Same class of bug as the earlier bands.created_by fix: INSERT ... RETURNING
-- on a self-created placeholder failed because can_view_placeholder() checks
-- created_by via a nested self-referential subquery rather than the row's
-- own column, which the RETURNING visibility check doesn't resolve reliably.
-- Checking created_by directly in the policy fixes it.
drop policy if exists placeholder_read on public.placeholder_musicians;
create policy placeholder_read on public.placeholder_musicians for select to public
using (
  (auth.role() = 'authenticated' and not is_band_leader())
  or is_admin()
  or (is_band_leader() and (created_by = auth.uid() or can_view_placeholder(id)))
);

-- musician_claims never had a DELETE path at all before yesterday's
-- placeholder-claims work -- the original design only ever rejects a
-- claim, never deletes it, so no RLS policy or table grant for DELETE was
-- ever set up. MusicianClaimsAdmin.jsx's new "Delete" button (for a
-- placeholder claim only) called .delete() against that gap and silently
-- no-opped every time -- caught live: a real claim was left behind on a
-- real gig, still "deleted" from the leader's point of view since the
-- click gave no error toast.
--
-- Scoped to admin or the gig's band leader, same predicate as
-- claims_update's leader/admin branch -- deliberately NOT self-delete for
-- a real musician's own submitted claim (that was never a thing before and
-- isn't being added now; MusicianClaimsAdmin.jsx only ever shows the
-- Delete button for a placeholder claim).
create policy claims_delete on public.musician_claims for delete to public
using (
  (select is_admin())
  or exists (select 1 from public.gigs g where g.id = musician_claims.gig_id and is_band_leader_of(g.band_id))
);

grant delete on public.musician_claims to authenticated;

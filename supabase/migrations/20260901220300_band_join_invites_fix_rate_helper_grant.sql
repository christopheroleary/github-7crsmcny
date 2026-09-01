-- Reverts the revoke from the previous migration: band_invite_rate_ok is
-- called FROM the band_join_invites_insert policy itself, so the querying
-- role (authenticated, inserting a real invite) needs EXECUTE to evaluate
-- that policy at all -- same reasoning 20260827100000 documents for
-- is_admin/is_band_leader_of/can_view_profile etc, which are deliberately
-- left PUBLIC-executable for the same structural reason. It only ever
-- returns a boolean (under the rate limit or not), never row data, so
-- there's nothing sensitive to protect by revoking it.
grant execute on function public.band_invite_rate_ok(uuid) to public;

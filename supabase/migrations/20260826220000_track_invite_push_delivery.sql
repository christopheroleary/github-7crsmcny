-- Surfaces push delivery outcome on the roster row itself, rather than it
-- being silently discarded inside the fire-and-forget notify-musician
-- webhook call. Previously an admin/leader had no way to know a musician
-- added to a gig wouldn't actually be notified outside the app -- the
-- bell row always got written regardless, but nothing reflected whether
-- the push attempt itself worked, so a broken subscription (see the VAPID
-- key mismatch fixed earlier) or someone who's never turned notifications
-- on both looked identical to "everything's fine."
--
-- Three states, distinguished because the fix differs:
--   'delivered'      -- at least one push actually succeeded
--   'failed'         -- they have a subscription, but every send failed
--                       (dead/mismatched device -- an actual bug/staleness)
--   'not_subscribed' -- no push_subscriptions row exists at all (never
--                       opted in, or opted out) -- expected, not a bug
-- null means "not yet attempted" -- e.g. rows added before this migration,
-- or a dep/placeholder with no real account to notify at all.
alter table public.gig_lineup
  add column invite_push_status text check (invite_push_status in ('delivered', 'failed', 'not_subscribed'));

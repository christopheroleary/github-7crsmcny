-- Lets a notification say which part of the gig page it relates to
-- (e.g. roster confirmation vs a payment claim), so clicking it can
-- scroll straight to that section instead of just opening the gig.
-- Nullable/unconstrained: non-gig notifications (enquiries, signups)
-- and older rows simply have no section. No RLS change needed --
-- inserts happen via the notify-admin/notify-musician edge functions
-- under the service role, and the existing notifications_select_own/
-- notifications_update_own policies already cover reading this column.
alter table public.notifications add column section text;

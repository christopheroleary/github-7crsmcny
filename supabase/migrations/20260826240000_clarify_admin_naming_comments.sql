-- Documentation only, no behaviour change. "admin" in these names is
-- historical and slightly misleading -- notify_admin_webhook() and the
-- admin_notified_at dedupe both actually target admins PLUS the leader(s)
-- of the specific band an event is scoped to (see getRecipientIds() in
-- notify-admin/index.ts and unconfirmed-roster-reminder/index.ts). An
-- actual rename was judged not worth the risk: the notify-admin edge
-- function's slug is a live URL hardcoded into this function's body, and
-- renaming it means standing up a new function and repointing every
-- caller rather than an in-place rename.
comment on function public.notify_admin_webhook() is
  'Despite the name, recipients are admins PLUS the leader(s) of the specific band the triggering row belongs to -- see pushToAdmins()/getRecipientIds() in notify-admin/index.ts.';

comment on column public.gig_lineup.admin_notified_at is
  'Set once unconfirmed-roster-reminder has nudged someone about this row, so it only fires once per invite. Despite the name, the nudge goes to admins PLUS the band''s leader(s), not admins only.';

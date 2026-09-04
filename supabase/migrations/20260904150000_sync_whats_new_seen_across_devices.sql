-- The What's New badge's "seen" marker was deliberately localStorage-only
-- (per-device, not account-synced) -- see the comment in App.jsx this
-- accompanies. In practice that trade-off produces exactly the false
-- positives it was meant to avoid worrying about: dismiss it on your
-- phone, the badge is still "unseen" on desktop; clear site data,
-- reinstall the PWA, or (on iOS Safari) simply not open the app for a
-- week and the browser can evict localStorage on its own, silently
-- resetting the marker with no real new entry behind it. A badge that
-- cries wolf gets ignored -- worth the extra sync to keep it honest.
--
-- text, not a foreign key or enum: WHATS_NEW ids are hand-written
-- date-based slugs (see src/data/whatsNew.js), stored as-is.
alter table public.profiles add column whats_new_seen_id text;

-- profiles' blanket SELECT was revoked in
-- 20260826130000_restrict_sensitive_profile_columns.sql, replaced by a
-- named column whitelist -- a column added afterward needs its own grant
-- or a query naming it fails outright with "permission denied for table
-- profiles" (confirmed the equivalent bug live for bands.is_solo earlier
-- today; not repeating it here). UPDATE is unaffected -- see that
-- migration's own comment, still a plain grant covering every column,
-- gated by the existing self-only row policy.
grant select (whats_new_seen_id) on public.profiles to authenticated;

-- Closes 72 of the 74 Supabase security-advisor warnings from this session's
-- audit. Every function below was individually verified before touching it
-- (see the two groups explicitly left alone, listed at the bottom, for what
-- was NOT safe to change):
--
-- Postgres grants EXECUTE to the PUBLIC pseudo-role by default on every new
-- function, unless explicitly revoked -- so these 23 functions were
-- callable by anon (and authenticated) purely as an artifact of that
-- default, never because anyone intended it. Revoking FROM PUBLIC removes
-- that accidental exposure without touching any real access path:
--   - The trigger/event-trigger-only ones (13) and the one internal-only
--     helper (1) get no re-grant at all -- confirmed every one is wired to
--     a real trigger (or, for rls_auto_enable, a ddl_command_end event
--     trigger) or only ever called via `perform` from inside another
--     function's body. Trigger/event-trigger firing and internal function
--     calls both run under the owner's privileges regardless of EXECUTE
--     grants to client-facing roles, and none of the 14 appear in a single
--     supabase.rpc(...) call anywhere in src/.
--   - The other 9 already have their own explicit `grant execute ... to
--     authenticated` sitting alongside the accidental PUBLIC one (confirmed
--     via information_schema.routine_privileges) -- revoking FROM PUBLIC
--     only removes anon's free ride, authenticated's real, intentional
--     grant is untouched.
--
-- Left deliberately alone (not in this migration):
--   - get_contract_by_token / get_invoice_by_token / get_quote_by_token /
--     sign_contract_by_token (both overloads) -- genuinely, intentionally
--     anon-callable: this is what powers the no-login client share-link
--     viewer in PublicDocumentView.jsx.
--   - is_admin / is_band_leader / is_band_leader_of / is_on_gig /
--     can_view_band / can_view_placeholder / can_view_profile -- referenced
--     inside RLS policies across the schema; the querying role (anon or
--     authenticated) needs EXECUTE to evaluate those policies at all.
--     Revoking these would break access to nearly every table.

-- ── Authenticated RPCs, anon access was accidental ──────────────────────────
revoke execute on function public.get_gig_roster_phones(uuid) from public;
revoke execute on function public.get_my_calendar_token() from public;
revoke execute on function public.get_payment_details(uuid) from public;
revoke execute on function public.get_profile_phones(uuid[]) from public;
revoke execute on function public.merge_placeholder_musician(uuid, uuid) from public;
revoke execute on function public.record_arcade_play(text, integer, uuid) from public;
revoke execute on function public.resend_gig_invite(uuid) from public;
revoke execute on function public.revoke_share_token(text, uuid) from public;
revoke execute on function public.rotate_share_token(text, uuid) from public;

-- ── Trigger-only (row triggers) ─────────────────────────────────────────────
revoke execute on function public.assign_band_leader_on_create() from public;
revoke execute on function public.enforce_gig_free_tier_cap() from public;
revoke execute on function public.guard_profile_insert() from public;
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.notify_admin_webhook() from public;
revoke execute on function public.notify_admins_of_feedback() from public;
revoke execute on function public.notify_fee_decrease() from public;
revoke execute on function public.notify_gig_message() from public;
revoke execute on function public.prevent_non_admin_public_song_change() from public;
revoke execute on function public.prevent_self_role_change() from public;
revoke execute on function public.protect_gig_lineup_self_update() from public;
revoke execute on function public.protect_subscription_fields() from public;

-- ── Event-trigger-only (fires on ddl_command_end, not a row trigger) ────────
revoke execute on function public.rls_auto_enable() from public;

-- ── Internal-only helper (called via `perform` from create_/update_musician_claim) ──
revoke execute on function public.assert_owns_receipts(jsonb) from public;

-- ── Pin search_path on the two flagged SECURITY INVOKER functions ──────────
-- Both already fully-qualify every reference with public., so this changes
-- nothing about their behaviour -- it just stops a malicious schema earlier
-- in a caller's search_path from being able to shadow an unqualified name.
alter function public.uk_tax_year_end(date) set search_path = '';
alter function public.set_receipt_retain_until() set search_path = '';

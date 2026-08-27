-- Fixes the two performance-advisor categories the user asked to act on
-- (auth_rls_initplan: 86 warnings; unindexed_foreign_keys: 49 info) out of
-- the 4 categories found. Left alone, not in this migration:
--   - multiple_permissive_policies (6, app_settings + enquiries) -- needs
--     DROP+CREATE with real behaviour-preserving logic, not a mechanical
--     rewrite (enquiries in particular: naively narrowing
--     enquiries_admin_manage away from INSERT would silently restrict
--     admins to the public form's status='new' check).
--   - unused_index (4, all on receipts/expenses/musician_claim_items) --
--     these are newer features; "never used yet" is at least as likely to
--     be low traffic so far as genuinely unnecessary, not worth dropping
--     without more signal.
--
-- ── auth_rls_initplan (86 policies, 33 tables) ──────────────────────────────
-- Postgres re-evaluates a bare auth.<function>() call in a policy's USING/
-- WITH CHECK expression once per row; wrapped as (select auth.<function>())
-- it becomes a stable sub-plan evaluated once per query instead. This is
-- Supabase's own documented fix (see the auth_rls_initplan lint's own
-- remediation link) and is purely a query-plan change -- every statement
-- below is the exact same boolean expression pg_policies already reported
-- for that policy, with only auth.uid()/auth.role() call sites wrapped.
-- Nothing else in any policy (the is_admin()/is_band_leader_of()/etc calls,
-- the EXISTS subqueries, the role/command each policy applies to) is
-- touched -- ALTER POLICY without a TO clause leaves the target roles
-- unchanged, and omitting USING or WITH CHECK where a policy never had one
-- leaves that side null exactly as before.

alter policy "arcade_plays_select" on public.arcade_plays
  using (((profile_id = (select auth.uid())) OR is_admin() OR ((gig_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM gig_lineup gl
  WHERE ((gl.gig_id = arcade_plays.gig_id) AND (gl.profile_id = (select auth.uid()))))))));

alter policy "availability_delete_own" on public.availability
  using (((profile_id = (select auth.uid())) OR is_admin()));

alter policy "availability_read" on public.availability
  using (((profile_id = (select auth.uid())) OR is_admin()));

alter policy "availability_update_own" on public.availability
  using (((profile_id = (select auth.uid())) OR is_admin()));

alter policy "availability_write_own" on public.availability
  with check (((profile_id = (select auth.uid())) OR is_admin()));

alter policy "backing_tracks_all_signed_in" on public.backing_tracks
  using (((select auth.role()) = 'authenticated'::text));

alter policy "band_leaders_select" on public.band_leaders
  using ((is_admin() OR (profile_id = (select auth.uid()))));

alter policy "bands_update_admin" on public.bands
  using ((is_admin() OR is_band_leader_of(id) OR (created_by = (select auth.uid()))));

alter policy "clients_delete" on public.clients
  using ((is_admin() OR (created_by = (select auth.uid()))));

alter policy "clients_insert" on public.clients
  with check ((is_admin() OR (is_band_leader() AND (created_by = (select auth.uid())))));

alter policy "clients_select" on public.clients
  using ((is_admin() OR (created_by = (select auth.uid())) OR (EXISTS ( SELECT 1
   FROM gigs g
  WHERE ((g.client_id = clients.id) AND is_band_leader_of(g.band_id))))));

alter policy "clients_update" on public.clients
  using ((is_admin() OR (created_by = (select auth.uid())) OR (EXISTS ( SELECT 1
   FROM gigs g
  WHERE ((g.client_id = clients.id) AND is_band_leader_of(g.band_id))))));

alter policy "expenses_delete" on public.expenses
  using (((profile_id = (select auth.uid())) OR is_admin()));

alter policy "expenses_insert" on public.expenses
  with check (((profile_id = (select auth.uid())) OR is_admin()));

alter policy "expenses_select" on public.expenses
  using (((profile_id = (select auth.uid())) OR is_admin()));

alter policy "expenses_update" on public.expenses
  using (((profile_id = (select auth.uid())) OR is_admin()))
  with check (((profile_id = (select auth.uid())) OR is_admin()));

alter policy "feedback_insert" on public.feedback
  with check ((profile_id = (select auth.uid())));

alter policy "feedback_select" on public.feedback
  using (((profile_id = (select auth.uid())) OR is_admin()));

alter policy "gig_lineup_select" on public.gig_lineup
  using ((is_admin() OR (profile_id = (select auth.uid())) OR is_on_gig(gig_id) OR (EXISTS ( SELECT 1
   FROM gigs g
  WHERE ((g.id = gig_lineup.gig_id) AND is_band_leader_of(g.band_id))))));

alter policy "gig_lineup_update_own" on public.gig_lineup
  using (((profile_id = (select auth.uid())) OR is_admin() OR (EXISTS ( SELECT 1
   FROM gigs g
  WHERE ((g.id = gig_lineup.gig_id) AND is_band_leader_of(g.band_id))))))
  with check (((profile_id = (select auth.uid())) OR is_admin() OR (EXISTS ( SELECT 1
   FROM gigs g
  WHERE ((g.id = gig_lineup.gig_id) AND is_band_leader_of(g.band_id))))));

alter policy "gig_messages_delete" on public.gig_messages
  using (((sender_id = (select auth.uid())) OR is_admin()));

alter policy "gig_messages_insert" on public.gig_messages
  with check (((sender_id = (select auth.uid())) AND (is_admin() OR is_band_leader_of(( SELECT gigs.band_id
   FROM gigs
  WHERE (gigs.id = gig_messages.gig_id))) OR is_on_gig(gig_id))));

alter policy "gig_requirements_select" on public.gig_requirements
  using ((is_admin() OR (EXISTS ( SELECT 1
   FROM gig_lineup
  WHERE ((gig_lineup.gig_id = gig_requirements.gig_id) AND (gig_lineup.profile_id = (select auth.uid()))))) OR (EXISTS ( SELECT 1
   FROM gigs g
  WHERE ((g.id = gig_requirements.gig_id) AND is_band_leader_of(g.band_id))))));

alter policy "gig_setlists_select" on public.gig_setlists
  using ((is_admin() OR (EXISTS ( SELECT 1
   FROM gig_lineup
  WHERE ((gig_lineup.gig_id = gig_setlists.gig_id) AND (gig_lineup.profile_id = (select auth.uid()))))) OR (EXISTS ( SELECT 1
   FROM gigs g
  WHERE ((g.id = gig_setlists.gig_id) AND is_band_leader_of(g.band_id))))));

alter policy "income_delete" on public.income
  using (((profile_id = (select auth.uid())) OR is_admin()));

alter policy "income_insert" on public.income
  with check (((profile_id = (select auth.uid())) OR is_admin()));

alter policy "income_select" on public.income
  using (((profile_id = (select auth.uid())) OR is_admin()));

alter policy "income_update" on public.income
  using (((profile_id = (select auth.uid())) OR is_admin()))
  with check (((profile_id = (select auth.uid())) OR is_admin()));

alter policy "instruments_read_all" on public.instruments
  using (((select auth.role()) = 'authenticated'::text));

alter policy "known_songs_delete" on public.known_songs
  using (((profile_id = (select auth.uid())) OR is_admin()));

alter policy "known_songs_insert" on public.known_songs
  with check (((profile_id = (select auth.uid())) OR is_admin()));

alter policy "known_songs_select" on public.known_songs
  using (((profile_id = (select auth.uid())) OR is_admin()));

alter policy "known_songs_update" on public.known_songs
  using (((profile_id = (select auth.uid())) OR is_admin()))
  with check (((profile_id = (select auth.uid())) OR is_admin()));

alter policy "mileage_delete" on public.mileage
  using (((profile_id = (select auth.uid())) OR is_admin()));

alter policy "mileage_insert" on public.mileage
  with check (((profile_id = (select auth.uid())) OR is_admin()));

alter policy "mileage_select" on public.mileage
  using (((profile_id = (select auth.uid())) OR is_admin()));

alter policy "mileage_update" on public.mileage
  using (((profile_id = (select auth.uid())) OR is_admin()))
  with check (((profile_id = (select auth.uid())) OR is_admin()));

alter policy "claim_items_delete" on public.musician_claim_items
  using ((is_admin() OR (EXISTS ( SELECT 1
   FROM musician_claims c
  WHERE ((c.id = musician_claim_items.claim_id) AND (c.profile_id = (select auth.uid())) AND (c.status = ANY (ARRAY['pending'::text, 'rejected'::text])))))));

alter policy "claim_items_insert" on public.musician_claim_items
  with check ((is_admin() OR (EXISTS ( SELECT 1
   FROM musician_claims c
  WHERE ((c.id = musician_claim_items.claim_id) AND (c.profile_id = (select auth.uid())) AND (c.status = ANY (ARRAY['pending'::text, 'rejected'::text])))))));

alter policy "claim_items_select" on public.musician_claim_items
  using ((is_admin() OR (EXISTS ( SELECT 1
   FROM musician_claims c
  WHERE ((c.id = musician_claim_items.claim_id) AND (c.profile_id = (select auth.uid()))))) OR (EXISTS ( SELECT 1
   FROM (musician_claims c
     JOIN gigs g ON ((g.id = c.gig_id)))
  WHERE ((c.id = musician_claim_items.claim_id) AND is_band_leader_of(g.band_id))))));

alter policy "claim_items_update" on public.musician_claim_items
  using ((is_admin() OR (EXISTS ( SELECT 1
   FROM musician_claims c
  WHERE ((c.id = musician_claim_items.claim_id) AND (c.profile_id = (select auth.uid())) AND (c.status = ANY (ARRAY['pending'::text, 'rejected'::text])))))))
  with check ((is_admin() OR (EXISTS ( SELECT 1
   FROM musician_claims c
  WHERE ((c.id = musician_claim_items.claim_id) AND (c.profile_id = (select auth.uid())) AND (c.status = ANY (ARRAY['pending'::text, 'rejected'::text])))))));

alter policy "claims_insert_own" on public.musician_claims
  with check (((profile_id = (select auth.uid())) AND (EXISTS ( SELECT 1
   FROM gig_lineup
  WHERE ((gig_lineup.gig_id = musician_claims.gig_id) AND (gig_lineup.profile_id = (select auth.uid())))))));

alter policy "claims_select" on public.musician_claims
  using (((profile_id = (select auth.uid())) OR is_admin() OR (EXISTS ( SELECT 1
   FROM gigs g
  WHERE ((g.id = musician_claims.gig_id) AND is_band_leader_of(g.band_id))))));

alter policy "claims_update" on public.musician_claims
  using ((((profile_id = (select auth.uid())) AND (status = ANY (ARRAY['pending'::text, 'rejected'::text]))) OR is_admin() OR (EXISTS ( SELECT 1
   FROM gigs g
  WHERE ((g.id = musician_claims.gig_id) AND is_band_leader_of(g.band_id))))))
  with check ((((profile_id = (select auth.uid())) AND (status = 'pending'::text)) OR is_admin() OR (EXISTS ( SELECT 1
   FROM gigs g
  WHERE ((g.id = musician_claims.gig_id) AND is_band_leader_of(g.band_id))))));

alter policy "musician_unavailable_dates_delete" on public.musician_unavailable_dates
  using (((profile_id = (select auth.uid())) OR is_admin()));

alter policy "musician_unavailable_dates_insert" on public.musician_unavailable_dates
  with check (((profile_id = (select auth.uid())) OR is_admin()));

alter policy "musician_unavailable_dates_select" on public.musician_unavailable_dates
  using (((profile_id = (select auth.uid())) OR is_admin()));

alter policy "notif_prefs_insert" on public.notification_preferences
  with check ((profile_id = (select auth.uid())));

alter policy "notif_prefs_select" on public.notification_preferences
  using ((profile_id = (select auth.uid())));

alter policy "notif_prefs_update" on public.notification_preferences
  using ((profile_id = (select auth.uid())));

alter policy "notifications_select_own" on public.notifications
  using ((profile_id = (select auth.uid())));

alter policy "notifications_update_own" on public.notifications
  using ((profile_id = (select auth.uid())));

alter policy "pks_delete" on public.placeholder_known_songs
  using ((is_admin() OR (is_band_leader() AND (EXISTS ( SELECT 1
   FROM placeholder_musicians pm
  WHERE ((pm.id = placeholder_known_songs.placeholder_id) AND ((pm.created_by = (select auth.uid())) OR (EXISTS ( SELECT 1
           FROM band_members bm
          WHERE ((bm.placeholder_id = pm.id) AND is_band_leader_of(bm.band_id)))))))))));

alter policy "pks_read" on public.placeholder_known_songs
  using (((((select auth.role()) = 'authenticated'::text) AND (NOT is_band_leader())) OR is_admin() OR (is_band_leader() AND can_view_placeholder(placeholder_id))));

alter policy "pks_update" on public.placeholder_known_songs
  using ((is_admin() OR (is_band_leader() AND (EXISTS ( SELECT 1
   FROM placeholder_musicians pm
  WHERE ((pm.id = placeholder_known_songs.placeholder_id) AND ((pm.created_by = (select auth.uid())) OR (EXISTS ( SELECT 1
           FROM band_members bm
          WHERE ((bm.placeholder_id = pm.id) AND is_band_leader_of(bm.band_id)))))))))))
  with check ((is_admin() OR (is_band_leader() AND (EXISTS ( SELECT 1
   FROM placeholder_musicians pm
  WHERE ((pm.id = placeholder_known_songs.placeholder_id) AND ((pm.created_by = (select auth.uid())) OR (EXISTS ( SELECT 1
           FROM band_members bm
          WHERE ((bm.placeholder_id = pm.id) AND is_band_leader_of(bm.band_id)))))))))));

alter policy "pks_write" on public.placeholder_known_songs
  with check ((is_admin() OR (is_band_leader() AND (EXISTS ( SELECT 1
   FROM placeholder_musicians pm
  WHERE ((pm.id = placeholder_known_songs.placeholder_id) AND ((pm.created_by = (select auth.uid())) OR (EXISTS ( SELECT 1
           FROM band_members bm
          WHERE ((bm.placeholder_id = pm.id) AND is_band_leader_of(bm.band_id)))))))))));

alter policy "ph_instr_delete" on public.placeholder_musician_instruments
  using ((is_admin() OR (is_band_leader() AND (EXISTS ( SELECT 1
   FROM placeholder_musicians pm
  WHERE ((pm.id = placeholder_musician_instruments.placeholder_id) AND ((pm.created_by = (select auth.uid())) OR (EXISTS ( SELECT 1
           FROM band_members bm
          WHERE ((bm.placeholder_id = pm.id) AND is_band_leader_of(bm.band_id)))))))))));

alter policy "ph_instr_write" on public.placeholder_musician_instruments
  with check ((is_admin() OR (is_band_leader() AND (EXISTS ( SELECT 1
   FROM placeholder_musicians pm
  WHERE ((pm.id = placeholder_musician_instruments.placeholder_id) AND ((pm.created_by = (select auth.uid())) OR (EXISTS ( SELECT 1
           FROM band_members bm
          WHERE ((bm.placeholder_id = pm.id) AND is_band_leader_of(bm.band_id)))))))))));

alter policy "placeholder_delete_admin" on public.placeholder_musicians
  using ((is_admin() OR (is_band_leader() AND (created_by = (select auth.uid())))));

alter policy "placeholder_update_admin" on public.placeholder_musicians
  using ((is_admin() OR (is_band_leader() AND ((created_by = (select auth.uid())) OR (EXISTS ( SELECT 1
   FROM band_members bm
  WHERE ((bm.placeholder_id = placeholder_musicians.id) AND is_band_leader_of(bm.band_id))))))));

alter policy "placeholder_write_admin" on public.placeholder_musicians
  with check ((is_admin() OR (is_band_leader() AND (created_by = (select auth.uid())))));

alter policy "profile_instruments_delete_own" on public.profile_instruments
  using (((profile_id = (select auth.uid())) OR is_admin()));

alter policy "profile_instruments_write_own" on public.profile_instruments
  with check (((profile_id = (select auth.uid())) OR is_admin()));

alter policy "profiles_update_own" on public.profiles
  using (((id = (select auth.uid())) OR is_admin()))
  with check (((id = (select auth.uid())) OR is_admin()));

alter policy "push_subs_delete" on public.push_subscriptions
  using ((profile_id = (select auth.uid())));

alter policy "push_subs_insert" on public.push_subscriptions
  with check ((profile_id = (select auth.uid())));

alter policy "push_subs_select" on public.push_subscriptions
  using ((profile_id = (select auth.uid())));

alter policy "push_subs_update" on public.push_subscriptions
  using ((profile_id = (select auth.uid())))
  with check ((profile_id = (select auth.uid())));

alter policy "receipts_delete" on public.receipts
  using (((profile_id = (select auth.uid())) OR is_admin()));

alter policy "receipts_insert" on public.receipts
  with check (((profile_id = (select auth.uid())) OR is_admin()));

alter policy "receipts_select" on public.receipts
  using (((profile_id = (select auth.uid())) OR is_admin()));

alter policy "receipts_update" on public.receipts
  using (((profile_id = (select auth.uid())) OR is_admin()))
  with check (((profile_id = (select auth.uid())) OR is_admin()));

alter policy "setlist_items_select" on public.setlist_items
  using ((is_admin() OR (EXISTS ( SELECT 1
   FROM ((setlists sl
     JOIN gig_setlists gs ON ((gs.setlist_id = sl.id)))
     JOIN gig_lineup gl ON ((gl.gig_id = gs.gig_id)))
  WHERE ((sl.id = setlist_items.setlist_id) AND (gl.profile_id = (select auth.uid()))))) OR (EXISTS ( SELECT 1
   FROM setlists sl
  WHERE ((sl.id = setlist_items.setlist_id) AND (sl.band_id IS NOT NULL) AND is_band_leader_of(sl.band_id))))));

alter policy "setlists_select" on public.setlists
  using ((is_admin() OR (EXISTS ( SELECT 1
   FROM (gig_setlists gs
     JOIN gig_lineup gl ON ((gl.gig_id = gs.gig_id)))
  WHERE ((gs.setlist_id = setlists.id) AND (gl.profile_id = (select auth.uid()))))) OR ((band_id IS NOT NULL) AND is_band_leader_of(band_id))));

alter policy "songs_delete_admin" on public.songs
  using ((is_admin() OR (is_band_leader() AND (created_by = (select auth.uid())))));

alter policy "songs_insert_admin" on public.songs
  with check ((is_admin() OR (is_band_leader() AND (created_by = (select auth.uid())))));

alter policy "songs_read_all" on public.songs
  using (((((select auth.role()) = 'authenticated'::text) AND (NOT is_band_leader())) OR is_admin() OR (is_band_leader() AND ((created_by = (select auth.uid())) OR is_public OR (EXISTS ( SELECT 1
   FROM (setlist_items si
     JOIN setlists sl ON ((sl.id = si.setlist_id)))
  WHERE ((si.song_id = songs.id) AND (sl.band_id IS NOT NULL) AND is_band_leader_of(sl.band_id))))))));

alter policy "songs_update_admin" on public.songs
  using ((is_admin() OR (is_band_leader() AND ((created_by = (select auth.uid())) OR (EXISTS ( SELECT 1
   FROM (setlist_items si
     JOIN setlists sl ON ((sl.id = si.setlist_id)))
  WHERE ((si.song_id = songs.id) AND (sl.band_id IS NOT NULL) AND is_band_leader_of(sl.band_id))))))));

alter policy "suppliers_delete" on public.suppliers
  using ((is_admin() OR (created_by = (select auth.uid()))));

alter policy "suppliers_insert" on public.suppliers
  with check ((is_admin() OR (is_band_leader() AND (created_by = (select auth.uid())))));

alter policy "suppliers_select" on public.suppliers
  using ((is_admin() OR (created_by = (select auth.uid())) OR (EXISTS ( SELECT 1
   FROM (gig_suppliers gs
     JOIN gig_lineup gl ON ((gl.gig_id = gs.gig_id)))
  WHERE ((gs.supplier_id = suppliers.id) AND (gl.profile_id = (select auth.uid()))))) OR (EXISTS ( SELECT 1
   FROM (gig_suppliers gs
     JOIN gigs g ON ((g.id = gs.gig_id)))
  WHERE ((gs.supplier_id = suppliers.id) AND is_band_leader_of(g.band_id))))));

alter policy "suppliers_update" on public.suppliers
  using ((is_admin() OR (created_by = (select auth.uid())) OR (EXISTS ( SELECT 1
   FROM (gig_suppliers gs
     JOIN gigs g ON ((g.id = gs.gig_id)))
  WHERE ((gs.supplier_id = suppliers.id) AND is_band_leader_of(g.band_id))))));

alter policy "venues_delete_admin" on public.venues
  using ((is_admin() OR (created_by = (select auth.uid()))));

alter policy "venues_insert_admin" on public.venues
  with check ((is_admin() OR (is_band_leader() AND (created_by = (select auth.uid())))));

alter policy "venues_select" on public.venues
  using ((is_admin() OR (EXISTS ( SELECT 1
   FROM (gigs g
     JOIN gig_lineup gl ON ((gl.gig_id = g.id)))
  WHERE ((g.venue_id = venues.id) AND (gl.profile_id = (select auth.uid()))))) OR (created_by = (select auth.uid())) OR (EXISTS ( SELECT 1
   FROM gigs g
  WHERE ((g.venue_id = venues.id) AND is_band_leader_of(g.band_id))))));

alter policy "venues_update_admin" on public.venues
  using ((is_admin() OR (created_by = (select auth.uid())) OR (EXISTS ( SELECT 1
   FROM gigs g
  WHERE ((g.venue_id = venues.id) AND is_band_leader_of(g.band_id))))));

-- ── unindexed_foreign_keys (49 columns, 34 tables) ──────────────────────────
-- Every one of these is a foreign-key column with no covering index. Not
-- applied blindly: cross-checked against the policy text above and this
-- schema's actual query patterns -- profile_id/gig_id/band_id/claim_id/
-- placeholder_id-style columns are exactly what the RLS policies' EXISTS
-- subqueries and is_band_leader_of()/is_on_gig() checks join against on
-- every single query against these tables, so an index here is a real
-- lookup-plan win, not a speculative one. IF NOT EXISTS makes this safe to
-- rerun.

create index if not exists backing_tracks_song_id_idx on public.backing_tracks (song_id);
create index if not exists band_leaders_added_by_idx on public.band_leaders (added_by);
create index if not exists band_leaders_profile_id_idx on public.band_leaders (profile_id);
create index if not exists band_members_instrument_id_idx on public.band_members (instrument_id);
create index if not exists band_members_placeholder_id_idx on public.band_members (placeholder_id);
create index if not exists band_members_profile_id_idx on public.band_members (profile_id);
create index if not exists bands_created_by_idx on public.bands (created_by);
create index if not exists clients_created_by_idx on public.clients (created_by);
create index if not exists enquiries_converted_gig_id_idx on public.enquiries (converted_gig_id);
create index if not exists expenses_profile_id_idx on public.expenses (profile_id);
create index if not exists feedback_profile_id_idx on public.feedback (profile_id);
create index if not exists gig_lineup_instrument_id_idx on public.gig_lineup (instrument_id);
create index if not exists gig_lineup_placeholder_id_idx on public.gig_lineup (placeholder_id);
create index if not exists gig_messages_sender_id_idx on public.gig_messages (sender_id);
create index if not exists gig_requirements_instrument_id_idx on public.gig_requirements (instrument_id);
create index if not exists gig_setlists_setlist_id_idx on public.gig_setlists (setlist_id);
create index if not exists gig_suppliers_created_by_idx on public.gig_suppliers (created_by);
create index if not exists gig_whatsapp_invites_placeholder_id_idx on public.gig_whatsapp_invites (placeholder_id);
create index if not exists gig_whatsapp_invites_profile_id_idx on public.gig_whatsapp_invites (profile_id);
create index if not exists gig_whatsapp_invites_sent_by_idx on public.gig_whatsapp_invites (sent_by);
create index if not exists gigs_client_id_idx on public.gigs (client_id);
create index if not exists gigs_first_dance_song_id_idx on public.gigs (first_dance_song_id);
create index if not exists gigs_venue_id_idx on public.gigs (venue_id);
create index if not exists income_profile_id_idx on public.income (profile_id);
create index if not exists invoice_items_invoice_id_idx on public.invoice_items (invoice_id);
create index if not exists invoice_payments_invoice_id_idx on public.invoice_payments (invoice_id);
create index if not exists known_songs_song_id_idx on public.known_songs (song_id);
create index if not exists mileage_profile_id_idx on public.mileage (profile_id);
create index if not exists musician_claim_items_claim_id_idx on public.musician_claim_items (claim_id);
create index if not exists notifications_gig_id_idx on public.notifications (gig_id);
create index if not exists notifications_profile_id_idx on public.notifications (profile_id);
create index if not exists outfit_assignments_gig_id_idx on public.outfit_assignments (gig_id);
create index if not exists outfit_assignments_outfit_id_idx on public.outfit_assignments (outfit_id);
create index if not exists outfit_assignments_profile_id_idx on public.outfit_assignments (profile_id);
create index if not exists placeholder_known_songs_song_id_idx on public.placeholder_known_songs (song_id);
create index if not exists placeholder_musician_instruments_instrument_id_idx on public.placeholder_musician_instruments (instrument_id);
create index if not exists placeholder_musicians_created_by_idx on public.placeholder_musicians (created_by);
create index if not exists placeholder_musicians_instrument_id_idx on public.placeholder_musicians (instrument_id);
create index if not exists placeholder_musicians_merged_into_idx on public.placeholder_musicians (merged_into);
create index if not exists profile_instruments_instrument_id_idx on public.profile_instruments (instrument_id);
create index if not exists push_subscriptions_profile_id_idx on public.push_subscriptions (profile_id);
create index if not exists quote_items_quote_id_idx on public.quote_items (quote_id);
create index if not exists quotes_converted_invoice_id_idx on public.quotes (converted_invoice_id);
create index if not exists setlist_items_setlist_id_idx on public.setlist_items (setlist_id);
create index if not exists setlist_items_song_id_idx on public.setlist_items (song_id);
create index if not exists setlists_band_id_idx on public.setlists (band_id);
create index if not exists songs_created_by_idx on public.songs (created_by);
create index if not exists suppliers_created_by_idx on public.suppliers (created_by);
create index if not exists venues_created_by_idx on public.venues (created_by);

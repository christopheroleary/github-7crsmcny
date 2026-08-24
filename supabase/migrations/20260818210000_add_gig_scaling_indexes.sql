-- Scaling prep: index the foreign key / filter columns the gig list queries
-- actually need, ahead of the gigs table growing from dozens into thousands.
-- Postgres doesn't auto-index foreign keys (only primary keys and unique
-- constraints), so these have been sequential-scanning -- invisible at low
-- row counts, increasingly costly as the tables grow.
--
-- Verified against the live schema (pg_indexes) rather than assumed: an
-- earlier draft of this migration also indexed gig_lineup.gig_id,
-- gig_requirements.gig_id, musician_claims.gig_id and invoices.gig_id, all
-- four of which are ALREADY covered as the leftmost column of an existing
-- unique constraint --
--   gig_lineup_gig_id_profile_id_key         (gig_id, profile_id)
--   gig_requirements_gig_id_instrument_id_key(gig_id, instrument_id)
--   musician_claims_gig_id_profile_id_key    (gig_id, profile_id)
--   invoices_gig_id_unique                   (gig_id)
-- so adding them would have cost write throughput and disk for nothing.
-- Only the genuinely uncovered columns are below.
--
-- Pure addition, no behaviour change: safe to run any time.

-- gigs has only pkey + the two share-token unique indexes, so both of these
-- are genuinely missing. band_id powers the gigs_select RLS check
-- (is_band_leader_of(band_id)); gig_date powers the .gte(gig_date, today)
-- floor and .order('gig_date') in fetchGigList, plus calendar month paging.
create index if not exists gigs_band_id_idx on public.gigs (band_id);
create index if not exists gigs_gig_date_idx on public.gigs (gig_date);

-- profile_id is the SECOND column of gig_lineup_gig_id_profile_id_key, so it
-- gets no benefit from that index. This powers the band member's own gig
-- lookup (.eq('profile_id', profileId)) that starts every member list load,
-- and is_on_gig().
create index if not exists gig_lineup_profile_id_idx on public.gig_lineup (profile_id);

-- Likewise the second column of musician_claims_gig_id_profile_id_key.
-- Powers the member's own claim-status lookup in fetchGigList.
create index if not exists musician_claims_profile_id_idx on public.musician_claims (profile_id);

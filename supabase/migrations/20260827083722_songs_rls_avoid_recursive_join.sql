-- Fixes the songs table statement-timeout (500s) on the setlist song
-- picker query (songs?select=id,title,artist&order=title.asc).
--
-- songs_read_all/songs_update_admin check "is this song used in one of my
-- led bands' setlists" via a raw inline join to setlist_items/setlists.
-- Every other cross-table RLS check in this schema (is_admin(),
-- is_band_leader(), is_band_leader_of(), is_on_gig()) is instead a
-- SECURITY DEFINER function owned by postgres (rolbypassrls=true), which
-- skips RLS entirely on the tables it queries internally. Because this one
-- join was written inline instead of wrapped the same way, Postgres also
-- had to enforce setlist_items' and setlists' own RLS policies while
-- evaluating it -- and those policies themselves embed further raw joins
-- to gig_setlists -> gig_lineup -> gigs, each with its own RLS. A single
-- plain songs select (no id filter -- the picker lists every song) was
-- expanding into a 100+ node recursive query plan.
--
-- Confirmed live via EXPLAIN ANALYZE impersonating a real band-leader test
-- account: even a tiny dataset (1 band, 3 setlists, 51 songs) touched
-- ~5,300 buffer pages and took 70ms fully warm-cache, plausibly explaining
-- the 3.5-4.7s timeouts seen in production with more setlists/gigs and a
-- cold cache.
--
-- Fix: wrap the same join in a SECURITY DEFINER function matching the
-- existing is_band_leader_of() pattern, so setlist_items/setlists access
-- inside it bypasses RLS instead of recursing. setlist_items.song_id and
-- setlists.band_id are already indexed, so the join itself is cheap once
-- the recursive RLS blowup is gone. No EXECUTE revoke -- like the other
-- RLS-helper functions (see 20260827100000_harden_function_execute_grants
-- .sql, which deliberately left is_admin/is_band_leader/is_band_leader_of/
-- is_on_gig alone), this must stay callable by authenticated/anon to
-- evaluate the policy.

create or replace function public.song_in_led_band_setlist(p_song_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from setlist_items si
    join setlists sl on sl.id = si.setlist_id
    where si.song_id = p_song_id
      and sl.band_id is not null
      and is_band_leader_of(sl.band_id)
  );
$$;

alter policy "songs_read_all" on public.songs
  using (((((select auth.role()) = 'authenticated'::text) AND (NOT is_band_leader())) OR is_admin() OR (is_band_leader() AND ((created_by = (select auth.uid())) OR is_public OR song_in_led_band_setlist(id)))));

alter policy "songs_update_admin" on public.songs
  using ((is_admin() OR (is_band_leader() AND ((created_by = (select auth.uid())) OR song_in_led_band_setlist(id)))));

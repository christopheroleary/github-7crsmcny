-- Admin-only: groups songs by normalized title (same normalization
-- ImportSetlist.jsx uses client-side) and returns every version in each
-- group with its usage (distinct gigs it's actually attached to via a
-- setlist, not just raw setlist_items rows -- a song sitting in a setlist
-- that's never been attached to a gig isn't "used" yet) and completeness
-- signals, so a "possible duplicates" panel can suggest which version to
-- keep without a human first having to notice the duplicate exists.
create or replace function public.get_song_duplicate_groups()
returns table (
  norm_title text,
  id uuid,
  title text,
  artist text,
  original_key text,
  has_lyrics boolean,
  has_video boolean,
  is_public boolean,
  gig_count bigint,
  setlist_item_count bigint
)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can view song duplicate groups';
  end if;

  return query
  with normalized as (
    select
      s.id, s.title, s.artist, s.original_key, s.lyrics, s.reference_url, s.is_public,
      trim(regexp_replace(regexp_replace(regexp_replace(lower(s.title), '[’`´'']', '', 'g'), '[^a-z0-9\s]', ' ', 'g'), '\s+', ' ', 'g')) as norm_title
    from public.songs s
  ),
  grouped as (
    select n.norm_title from normalized n group by n.norm_title having count(*) > 1
  )
  select
    n.norm_title, n.id, n.title, n.artist, n.original_key,
    (n.lyrics is not null and n.lyrics <> ''),
    (n.reference_url is not null and n.reference_url <> ''),
    n.is_public,
    (select count(distinct gs.gig_id) from public.setlist_items si join public.gig_setlists gs on gs.setlist_id = si.setlist_id where si.song_id = n.id),
    (select count(*) from public.setlist_items si where si.song_id = n.id)
  from normalized n
  join grouped g on g.norm_title = n.norm_title
  order by n.norm_title, 9 desc;
end;
$$;

grant execute on function public.get_song_duplicate_groups() to authenticated;

-- Admin-only: merges p_loser_id into p_winner_id -- backfills any field
-- the winner is missing from the loser (so the survivor ends up with the
-- union of both versions' data, not just whichever happened to win),
-- repoints every table that references a song, then deletes the loser.
-- known_songs/placeholder_known_songs are unique per (person, song), so a
-- musician who already ticked both versions is handled with "on conflict
-- do nothing" -- their existing tick on the winner is left alone rather
-- than erroring or being overwritten.
create or replace function public.merge_duplicate_songs(p_winner_id uuid, p_loser_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can merge songs';
  end if;

  if p_winner_id = p_loser_id then
    raise exception 'Cannot merge a song into itself';
  end if;

  update public.songs w
    set lyrics = coalesce(nullif(w.lyrics, ''), l.lyrics),
        reference_url = coalesce(nullif(w.reference_url, ''), l.reference_url),
        artist = coalesce(nullif(w.artist, ''), l.artist),
        original_key = coalesce(w.original_key, l.original_key),
        bpm = coalesce(w.bpm, l.bpm),
        notes = coalesce(nullif(w.notes, ''), l.notes),
        year_released = coalesce(w.year_released, l.year_released),
        facts = coalesce(nullif(w.facts, ''), l.facts),
        genius_url = coalesce(nullif(w.genius_url, ''), l.genius_url)
    from public.songs l
    where w.id = p_winner_id and l.id = p_loser_id;

  update public.setlist_items set song_id = p_winner_id where song_id = p_loser_id;
  update public.backing_tracks set song_id = p_winner_id where song_id = p_loser_id;
  update public.song_requests set song_id = p_winner_id where song_id = p_loser_id;
  update public.gigs set first_dance_song_id = p_winner_id where first_dance_song_id = p_loser_id;

  insert into public.known_songs (profile_id, song_id, can_sing_lead)
    select profile_id, p_winner_id, can_sing_lead from public.known_songs where song_id = p_loser_id
    on conflict (profile_id, song_id) do nothing;
  delete from public.known_songs where song_id = p_loser_id;

  insert into public.placeholder_known_songs (placeholder_id, song_id, can_sing_lead)
    select placeholder_id, p_winner_id, can_sing_lead from public.placeholder_known_songs where song_id = p_loser_id
    on conflict (placeholder_id, song_id) do nothing;
  delete from public.placeholder_known_songs where song_id = p_loser_id;

  delete from public.songs where id = p_loser_id;
end;
$$;

grant execute on function public.merge_duplicate_songs(uuid, uuid) to authenticated;

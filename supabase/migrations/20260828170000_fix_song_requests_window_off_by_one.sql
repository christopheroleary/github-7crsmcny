-- 20260827180000_song_requests_window_display.sql set out to align all
-- three of get_gig_requests_page / submit_song_request /
-- song_requests_anon_select on "opens the day before the gig, closes at
-- the end of the gig's own calendar day" -- i.e. valid whenever
-- current_date is between (gig_date - 1) and gig_date.
--
-- The SQL it actually wrote flipped that: `gig_date between
-- (current_date - 1) and current_date` is NOT the same relation --
-- solving for current_date, that's true when current_date is between
-- gig_date and (gig_date + 1), i.e. the window opened ON the gig's own
-- day and stayed open through the day AFTER, a full day late and shifted
-- the wrong direction versus the "opens the day before" every comment,
-- the UI text, and the client-side requestWindow() in
-- SongRequestsPanel.jsx all describe. Confirmed live: a confirmed gig
-- dated tomorrow failed the check today, when it should already be open.
--
-- The correct SQL form of "current_date between gig_date-1 and gig_date"
-- is `gig_date between current_date and (current_date + 1)`.

create or replace function public.get_gig_requests_page(p_token uuid)
returns json
language sql
stable
security definer
set search_path to 'public'
as $$
  select json_build_object(
    'gig_id', g.id,
    'gig_date', g.gig_date,
    'band_name', b.name,
    'logo_url', b.logo_url,
    'songs', (
      select coalesce(json_agg(distinct jsonb_build_object(
        'id', s.id, 'title', s.title, 'artist', s.artist
      )), '[]'::json)
      from public.gig_setlists gs
      join public.setlist_items si on si.setlist_id = gs.setlist_id
      join public.songs s on s.id = si.song_id
      where gs.gig_id = g.id
    ),
    'requests', (
      select coalesce(json_agg(jsonb_build_object(
        'id', r.id, 'song_id', r.song_id, 'requested_text', r.requested_text,
        'title', s.title, 'artist', s.artist,
        'request_count', r.request_count, 'status', r.status
      ) order by r.request_count desc, r.updated_at desc), '[]'::json)
      from public.song_requests r
      left join public.songs s on s.id = r.song_id
      where r.gig_id = g.id
    )
  )
  from public.gigs g
  join public.bands b on b.id = g.band_id
  where g.requests_token = p_token
    and g.status != 'cancelled'
    and g.gig_date between current_date and (current_date + 1);
$$;

create or replace function public.submit_song_request(
  p_token uuid,
  p_song_id uuid default null,
  p_requested_text text default null
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_gig_id uuid;
  v_text text;
  v_dedup_key text;
  v_strip_pattern text;
  v_row public.song_requests;
begin
  select id into v_gig_id
  from public.gigs
  where requests_token = p_token
    and status != 'cancelled'
    and gig_date between current_date and (current_date + 1);

  if v_gig_id is null then
    raise exception 'This request page is not available.';
  end if;

  if p_song_id is not null then
    if not exists (
      select 1 from public.gig_setlists gs
      join public.setlist_items si on si.setlist_id = gs.setlist_id
      where gs.gig_id = v_gig_id and si.song_id = p_song_id
    ) then
      raise exception 'That song is not on this gig''s setlist.';
    end if;
    v_text := null;
    v_dedup_key := p_song_id::text;
  else
    v_strip_pattern := '['
      || chr(1)     || '-' || chr(31)
      || chr(127)   || '-' || chr(159)
      || chr(8203)  || '-' || chr(8207)
      || chr(8234)  || '-' || chr(8238)
      || chr(8294)  || '-' || chr(8297)
      || chr(65279)
      || ']';
    v_text := btrim(regexp_replace(p_requested_text, v_strip_pattern, '', 'g'));
    if v_text is null or char_length(v_text) = 0 then
      raise exception 'Enter a song to request.';
    end if;
    if char_length(v_text) > 150 then
      v_text := left(v_text, 150);
    end if;
    v_dedup_key := lower(v_text);
  end if;

  if not exists (select 1 from public.song_requests where gig_id = v_gig_id and dedup_key = v_dedup_key) then
    if (select count(*) from public.song_requests where gig_id = v_gig_id) >= 300 then
      raise exception 'This gig has reached its request limit for tonight.';
    end if;
  end if;

  insert into public.song_requests (gig_id, song_id, requested_text)
  values (v_gig_id, p_song_id, v_text)
  on conflict (gig_id, dedup_key)
  do update set request_count = song_requests.request_count + 1, updated_at = now()
  returning * into v_row;

  return json_build_object('id', v_row.id, 'request_count', v_row.request_count);
end;
$$;

alter policy "song_requests_anon_select" on public.song_requests
using (
  status != 'dismissed'
  and exists (
    select 1 from public.gigs g
    where g.id = song_requests.gig_id
      and g.status != 'cancelled'
      and g.gig_date between current_date and (current_date + 1)
  )
);

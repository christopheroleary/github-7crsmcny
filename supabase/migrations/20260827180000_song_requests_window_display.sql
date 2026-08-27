-- Prompted by a direct request: the admin/band-leader panel didn't show
-- when a gig's QR code actually starts/stops working, so there was no
-- way to know from the UI alone. Fixing that surfaced a real
-- inconsistency to fix first: the last hardening pass (20260827170000)
-- narrowed song_requests_anon_select's window to gig_date-1..gig_date
-- (dropping the "+1 day" side, which only ever covered a gig that
-- hasn't happened yet -- never a real use case), but left
-- get_gig_requests_page and submit_song_request on the old
-- gig_date-1..gig_date+1 window. That meant a guest could still load the
-- page or submit a request for a gig up to a day before it happens, even
-- though the realtime leaderboard would silently stop updating for them
-- -- three windows that should be one. Aligned all three to
-- gig_date-1..gig_date, so there's a single rule to display and explain:
-- opens the day before the gig (covers a gig still running past
-- midnight, the actual reason for the -1 side existing) and closes at
-- the end of the gig's own calendar day.

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
    and g.gig_date between (current_date - 1) and current_date;
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
    and gig_date between (current_date - 1) and current_date;

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

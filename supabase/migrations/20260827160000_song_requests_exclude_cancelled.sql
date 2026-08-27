-- Found during live verification: a cancelled gig within its date window
-- still accepted and displayed song requests, since get_gig_requests_page/
-- submit_song_request only checked gig_date, never status. A cancelled
-- gig shouldn't be soliciting requests at all.

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
    and g.gig_date between (current_date - 1) and (current_date + 1);
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
  v_row public.song_requests;
begin
  select id into v_gig_id
  from public.gigs
  where requests_token = p_token
    and status != 'cancelled'
    and gig_date between (current_date - 1) and (current_date + 1);

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
  else
    v_text := btrim(p_requested_text);
    if v_text is null or char_length(v_text) = 0 then
      raise exception 'Enter a song to request.';
    end if;
    if char_length(v_text) > 150 then
      v_text := left(v_text, 150);
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

-- Anon leaderboard read follows the same rule.
drop policy "song_requests_anon_select" on public.song_requests;
create policy "song_requests_anon_select" on public.song_requests for select
to anon
using (
  exists (
    select 1 from public.gigs g
    where g.id = song_requests.gig_id
      and g.status != 'cancelled'
      and g.gig_date between (current_date - 1) and (current_date + 1)
  )
);

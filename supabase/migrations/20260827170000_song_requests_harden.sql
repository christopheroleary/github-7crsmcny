-- Hardening pass on the anonymous song-request entry point, prompted by a
-- direct request to review it for injection/abuse risk. Confirmed (by
-- reading the actual rendering code, not assuming): classic XSS is not
-- possible anywhere guest text ends up -- PublicSongRequests.jsx,
-- SongRequestsPanel.jsx and NotificationBell.jsx all render it as plain
-- JSX text (React auto-escapes), the print-table-tent HTML never includes
-- guest text, and the Web Push API never interprets HTML in title/body.
-- SQL injection is likewise not possible -- submit_song_request only ever
-- uses typed function parameters, no dynamic SQL. Two real gaps found and
-- fixed here instead:

-- 1. song_requests_anon_select was scoped to "any currently-active gig",
-- not to the specific gig a guest's requests_token actually points at --
-- RLS has no way to check "the token this session was handed" for an
-- unauthenticated role, so this can't be closed completely without
-- dropping anon realtime entirely (a real tradeoff, deliberately kept:
-- the data itself is song titles/artists/counts, not client/venue/
-- financial data). Tightened what's actually achievable instead:
--   - the "+1 day" side of the window covered gigs that haven't
--     happened yet, which was never a real use case -- dropped it.
--   - anon's grant was a blanket `select` on every column, including
--     dedup_key (an internal implementation detail) and created_at
--     (unused by the guest UI) -- narrowed to just what's rendered.
--   - dismissed requests are no longer visible to anon at all --
--     nothing legitimate needs to see a request the band already
--     dismissed.
alter policy "song_requests_anon_select" on public.song_requests
using (
  status != 'dismissed'
  and exists (
    select 1 from public.gigs g
    where g.id = song_requests.gig_id
      and g.status != 'cancelled'
      and g.gig_date between (current_date - 1) and current_date
  )
);

revoke select on public.song_requests from anon;
grant select (id, gig_id, song_id, requested_text, request_count, status) on public.song_requests to anon;

-- 2. No ceiling on distinct requests per gig -- someone scripting rapid,
-- distinct free-text submissions (identical text just increments an
-- existing row's counter, so this only bites on genuinely new rows)
-- could bloat the table and, worse, spam the band's phones, since
-- notify_song_request fires a push on every new row. 300 distinct
-- requests is far beyond what a real gig produces -- a circuit breaker,
-- not a real-world limit -- and only blocks *new* songs; an already-
-- popular song already in the table can still rack up votes past it.
--
-- Also strips control characters, zero-width characters, and RTL/LTR
-- override characters from free text -- rendering is already safe
-- (confirmed above), but this content still reaches push notifications
-- and an admin's screen, so stripping characters with no legitimate use
-- in a song title is cheap defense-in-depth against display spoofing.
-- Built via chr(<codepoint>) rather than literal characters in the
-- source -- an invisible/control character typed directly into this
-- file would be exactly the kind of thing this migration is trying to
-- strip, and unverifiable by eye either way.
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
    v_dedup_key := p_song_id::text;
  else
    v_strip_pattern := '['
      || chr(1)     || '-' || chr(31)    -- C0 controls (chr(0)/NUL can't occur in a Postgres text value at all)
      || chr(127)   || '-' || chr(159)   -- DEL + C1 controls
      || chr(8203)  || '-' || chr(8207)  -- zero-width space/ZWNJ/ZWJ/LRM/RLM (U+200B-U+200F)
      || chr(8234)  || '-' || chr(8238)  -- LRE/RLE/PDF/LRO/RLO direction override (U+202A-U+202E)
      || chr(8294)  || '-' || chr(8297)  -- LRI/RLI/FSI/PDI direction isolate (U+2066-U+2069)
      || chr(65279)                      -- BOM / zero-width no-break space (U+FEFF)
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

  -- Ceiling only applies to a genuinely new song -- mirrors the
  -- generated dedup_key column's own formula, so keep the two in sync
  -- if that formula ever changes.
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

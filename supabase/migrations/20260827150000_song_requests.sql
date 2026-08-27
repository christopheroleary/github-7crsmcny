-- QR-code dancefloor song requests: guests scan a code at the gig and
-- request a song from the band's real setlist, with no login. See the
-- "QR-code dancefloor song requests" plan for the full design rationale.

-- Every gig gets an unguessable token, same security model as the
-- invoice/quote/contract share tokens (gen_random_uuid(), 122 bits of
-- entropy) rather than gigs.share_code -- that column is a bare
-- Math.random()-generated internal deep-link shim with no DB generator
-- and no SECURITY DEFINER RPC, not a public credential.
alter table public.gigs add column requests_token uuid unique not null default gen_random_uuid();

create table public.song_requests (
  id uuid primary key default gen_random_uuid(),
  gig_id uuid not null references public.gigs(id) on delete cascade,
  song_id uuid references public.songs(id) on delete cascade,
  -- "Can't find it? Request anything" fallback -- a setlist-only limit
  -- would feel broken for real requests, but fully open free-text-only
  -- would lose the request_count dedup/leaderboard entirely.
  requested_text text,
  -- Lets ON CONFLICT dedup a picked song and a hand-typed one against the
  -- same target, and normalises free text (trim + lowercase) so "Angels"
  -- and " angels " count as the same request instead of two rows.
  dedup_key text generated always as (
    coalesce(song_id::text, lower(btrim(requested_text)))
  ) stored,
  request_count integer not null default 1,
  status text not null default 'pending' check (status in ('pending', 'played', 'dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint song_requests_exactly_one_target check (
    (song_id is not null) != (requested_text is not null)
  ),
  constraint song_requests_text_length check (
    requested_text is null or char_length(requested_text) <= 150
  ),
  constraint song_requests_text_not_blank check (
    requested_text is null or char_length(btrim(requested_text)) > 0
  ),
  unique (gig_id, dedup_key)
);

create index song_requests_gig_id_idx on public.song_requests (gig_id);

alter table public.song_requests enable row level security;

-- Band's own (authenticated) view: whole roster can see the queue (fun,
-- low-stakes information), same shape as gig_messages_select. Only
-- admin/the leading band leader can change status, so a random band
-- member can't clear someone else's queue mid-gig.
create policy "song_requests_select" on public.song_requests for select
using (
  is_admin()
  or is_band_leader_of((select band_id from public.gigs where id = gig_id))
  or is_on_gig(gig_id)
);

create policy "song_requests_update_status" on public.song_requests for update
using (
  is_admin()
  or is_band_leader_of((select band_id from public.gigs where id = gig_id))
)
with check (
  is_admin()
  or is_band_leader_of((select band_id from public.gigs where id = gig_id))
);

-- Anonymous guest leaderboard. song_requests carries no sensitive data
-- (a song title, an artist, a count -- no client/venue/financial data),
-- so a scoped-but-simple anon policy is an acceptable trade: readable
-- only while the parent gig is within its active request window, not
-- the full historical table. This is also what makes the Realtime
-- filter (gig_id=eq.<id>) meaningful for a legitimate guest rather than
-- relying on obscurity alone.
create policy "song_requests_anon_select" on public.song_requests for select
to anon
using (
  exists (
    select 1 from public.gigs g
    where g.id = song_requests.gig_id
      and g.gig_date between (current_date - 1) and (current_date + 1)
  )
);

grant select, update on public.song_requests to authenticated;
grant select on public.song_requests to anon;

alter publication supabase_realtime add table public.song_requests;

-- ── Guest-facing RPCs ────────────────────────────────────────────────────────

-- Returns null for an unknown token or a gig outside its active window,
-- so a stale/guessed token reveals nothing -- same shape as
-- get_public_band_page returning null for an unpublished slug. Only
-- title/artist are exposed from songs, never lyrics/reference_url/
-- created_by, matching how get_invoice_by_token strips bank details
-- once an invoice is settled.
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
    and g.gig_date between (current_date - 1) and (current_date + 1);
$$;

-- Single choke point for every validation rule on the write side: token
-- + active window, p_song_id (if given) must actually belong to a
-- setlist attached to this gig, free text trimmed/length-checked, then
-- the upsert-increment. A guest never gets a raw table grant.
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

grant execute on function public.get_gig_requests_page(uuid) to anon, authenticated;
grant execute on function public.submit_song_request(uuid, uuid, text) to anon, authenticated;

-- ── Push notification on a genuinely new request ────────────────────────────
-- Fires after insert only -- a repeat request for the same song is an
-- UPDATE (the counter bump via ON CONFLICT), so the band gets pushed
-- once per new song, never spammed by duplicate taps. Modeled directly
-- on notify_gig_message().
create or replace function public.notify_song_request()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform net.http_post(
    'https://uzblypxepztdramotjcc.supabase.co/functions/v1/notify-musician',
    jsonb_build_object('type', 'INSERT', 'table', 'song_requests', 'record', to_jsonb(new)),
    '{}'::jsonb,
    '{"Content-type":"application/json"}'::jsonb,
    5000
  );
  return new;
end;
$function$;

create trigger song_requests_notify_roster
  after insert on public.song_requests
  for each row execute function public.notify_song_request();

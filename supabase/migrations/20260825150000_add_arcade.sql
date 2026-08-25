-- Offline-friendly break-time games, played from a gig's own page -- built
-- for rapport/engagement (compete against whoever else is on that gig's
-- roster) rather than anything financial, so the anti-cheat bar here is
-- "can't be gamed by casually poking the API", not airtight.
create table public.arcade_plays (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  game_key text not null,
  score integer not null check (score >= 0),
  -- Which gig this play happened at -- drives the per-gig leaderboard.
  -- Nullable since a future non-gig entry point isn't ruled out, but every
  -- current entry point (the gig detail pages) always passes one.
  gig_id uuid references public.gigs(id) on delete cascade,
  played_at timestamptz not null default now()
);

create index arcade_plays_profile_idx on public.arcade_plays (profile_id, game_key);
create index arcade_plays_gig_idx on public.arcade_plays (gig_id, game_key) where gig_id is not null;
create index arcade_plays_played_at_idx on public.arcade_plays (played_at);

alter table public.arcade_plays enable row level security;

-- Everyone can see their own play history (personal best). Seeing someone
-- else's play requires having actually shared a gig with them -- the whole
-- point is comparing scores with the people you're standing next to, not a
-- global scoreboard of strangers.
create policy arcade_plays_select on public.arcade_plays
for select to authenticated
using (
  profile_id = auth.uid()
  or public.is_admin()
  or (
    gig_id is not null
    and exists (
      select 1 from public.gig_lineup gl
      where gl.gig_id = arcade_plays.gig_id and gl.profile_id = auth.uid()
    )
  )
);

-- No direct client insert -- goes through record_arcade_play below so the
-- 3-lives-a-day cap is enforced somewhere a browser console can't skip it.
grant select on public.arcade_plays to authenticated;

-- security definer so it can both read (for the lives check) and write
-- past the base table's insert-less grant, while still checking auth.uid()
-- itself rather than trusting a caller-supplied profile_id.
create or replace function public.record_arcade_play(p_game_key text, p_score integer, p_gig_id uuid default null)
returns public.arcade_plays
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_today_count integer;
  v_row public.arcade_plays;
begin
  if p_score < 0 then
    raise exception 'Score cannot be negative';
  end if;

  -- Lives are shared across every game, not per-game -- counts today's
  -- plays regardless of game_key. UK-local day boundary, not UTC, so the
  -- reset lands at midnight for the people actually using this at a gig.
  select count(*) into v_today_count
  from public.arcade_plays
  where profile_id = auth.uid()
    and (played_at at time zone 'Europe/London')::date = (now() at time zone 'Europe/London')::date;

  if v_today_count >= 3 then
    raise exception 'No lives left today — come back tomorrow';
  end if;

  insert into public.arcade_plays (profile_id, game_key, score, gig_id)
  values (auth.uid(), p_game_key, p_score, p_gig_id)
  returning * into v_row;

  return v_row;
end;
$function$;

grant execute on function public.record_arcade_play(text, integer, uuid) to authenticated;

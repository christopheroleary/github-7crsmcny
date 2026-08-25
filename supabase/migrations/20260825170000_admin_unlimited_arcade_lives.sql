-- The 3-lives-a-day cap is for musicians building rapport at a gig -- an
-- admin poking around to test/demo the games shouldn't burn through their
-- own daily allowance (and has previously had to be reset by hand mid-session).
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

  if not public.is_admin() then
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
  end if;

  insert into public.arcade_plays (profile_id, game_key, score, gig_id)
  values (auth.uid(), p_game_key, p_score, p_gig_id)
  returning * into v_row;

  return v_row;
end;
$function$;

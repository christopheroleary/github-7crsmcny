import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

const DAILY_LIVES = 3;

// UK-local day boundary, matching record_arcade_play's own Europe/London
// cutoff server-side -- otherwise a play just after 11pm BST could count
// against "today" locally but land in tomorrow's UTC bucket, or vice versa.
function londonDateKey(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(d);
}

// Shared across every game on a gig page -- lives, today's play count, and
// both leaderboards (this gig's roster, and all-time personal bests) live
// here so switching games doesn't refetch from scratch, and so the picker
// screen can show "2 lives left" without a specific game being open yet.
export function useArcade(gigId, profileId) {
  const [todayCount, setTodayCount] = useState(0);
  const [gigScores, setGigScores] = useState([]);
  const [personalBests, setPersonalBests] = useState({});
  const [namesById, setNamesById] = useState({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!profileId) return;
    setLoading(true);
    const today = londonDateKey();

    const [{ data: mine }, { data: gigRows }] = await Promise.all([
      supabase.from('arcade_plays').select('game_key, score, played_at').eq('profile_id', profileId),
      gigId
        ? supabase
            .from('arcade_plays')
            .select('profile_id, game_key, score, profiles(full_name)')
            .eq('gig_id', gigId)
        : Promise.resolve({ data: [] }),
    ]);

    const countToday = (mine || []).filter((p) => londonDateKey(new Date(p.played_at)) === today).length;
    setTodayCount(countToday);

    const bests = {};
    (mine || []).forEach((p) => {
      if (!bests[p.game_key] || p.score > bests[p.game_key]) bests[p.game_key] = p.score;
    });
    setPersonalBests(bests);

    setGigScores(gigRows || []);
    const names = {};
    (gigRows || []).forEach((r) => { names[r.profile_id] = r.profiles?.full_name || 'Unknown'; });
    setNamesById(names);

    setLoading(false);
  }, [gigId, profileId]);

  useEffect(() => { load(); }, [load]);

  const livesLeft = Math.max(0, DAILY_LIVES - todayCount);

  async function submitScore(gameKey, score) {
    const { data, error } = await supabase.rpc('record_arcade_play', {
      p_game_key: gameKey,
      p_score: Math.round(score),
      p_gig_id: gigId || null,
    });
    if (error) return { error };
    await load();
    return { data };
  }

  // Best score per player for one game, this gig only -- what the "who's
  // top of Snake tonight" board actually needs, not every play ever logged.
  function gigLeaderboardFor(gameKey) {
    const bestByProfile = {};
    gigScores.filter((r) => r.game_key === gameKey).forEach((r) => {
      if (!bestByProfile[r.profile_id] || r.score > bestByProfile[r.profile_id]) bestByProfile[r.profile_id] = r.score;
    });
    return Object.entries(bestByProfile)
      .map(([profile_id, score]) => ({ profile_id, score, name: namesById[profile_id] || 'Unknown' }))
      .sort((a, b) => b.score - a.score);
  }

  return { loading, livesLeft, personalBests, submitScore, gigLeaderboardFor, refresh: load };
}

export { DAILY_LIVES };

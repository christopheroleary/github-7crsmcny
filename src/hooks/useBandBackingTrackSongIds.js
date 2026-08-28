import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

// Which songs (out of a whole band's setlist) actually have a backing track
// attached, band-wide rather than scoped to any one setlist -- so it stays
// correct if a song is added to the setlist later without needing its own
// refetch. Used purely to decide whether the "Backing track" button should
// appear on a song row at all; RLS (backing_tracks_select) is still what
// actually decides who can read the tracks themselves.
export default function useBandBackingTrackSongIds(bandId) {
  const [songIds, setSongIds] = useState(new Set());
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!bandId) {
      setSongIds(new Set());
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase.from('backing_tracks').select('song_id').eq('band_id', bandId);
    setSongIds(new Set((data || []).map((r) => r.song_id)));
    setLoading(false);
  }, [bandId]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { songIds, loading, reload };
}

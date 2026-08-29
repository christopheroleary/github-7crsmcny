import { useMemo, useCallback } from 'react';
import StagePlot from './StagePlot.jsx';
import { buildStagePlotSeed } from '../utils/stagePlotAdapter.js';
import { useGigStagePlot } from '../hooks/useGigStagePlot.js';
import useBandBackingTrackSongIds from '../hooks/useBandBackingTrackSongIds.js';

/**
 * Gig-section wrapper around the vendored StagePlot tool -- same shape as
 * GigSetlist.jsx/GigRoster.jsx: takes already-fetched gig/venue/lineup
 * (from useOfflineGigData, no separate fetch here) and handles seeding +
 * persistence. Admin/leader gets full editing (autosave on every drag,
 * same as GigStagePlotPage.example.jsx's recommended default); musicians
 * get `readOnly`, which also has no onSave/onConfigChange wired at all --
 * belt-and-suspenders alongside the RLS policies that are what actually
 * block a musician's write (see the stage_plot migration).
 */
export default function GigStagePlot({ gigId, bandId, gig, venue, lineup, setlists, readOnly }) {
  const { songIds: backingTrackSongIds } = useBandBackingTrackSongIds(bandId);

  // Real automation, not a manual flag: true if this gig's attached
  // setlist has any song with a backing track saved for this band.
  const hasBackingTracks = useMemo(() => {
    return (setlists || []).some((sl) =>
      (sl.setlist_items || []).some((item) => item.songs && backingTrackSongIds.has(item.songs.id))
    );
  }, [setlists, backingTrackSongIds]);

  const buildSeed = useCallback(
    () => buildStagePlotSeed({ gig, venue, lineup, hasBackingTracks }),
    [gig, venue, lineup, hasBackingTracks]
  );

  const { config, loading, error, save } = useGigStagePlot(gigId, buildSeed);

  if (loading) {
    return (
      <div className="roster-section">
        <h3 className="roster-section__title">Stage plot</h3>
        <p className="state-message">Loading stage plot…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="roster-section">
        <h3 className="roster-section__title">Stage plot</h3>
        <p className="state-message state-message--error">Couldn't load: {error}</p>
      </div>
    );
  }

  // Stamped with the gig id so StagePlot's own identity check
  // (initialConfig !== the last one it saw) treats a genuinely different
  // gig's seed as something to load, not the same object re-rendering.
  const seed = { ...config, __gigId: gigId };

  return (
    <div className="roster-section">
      <h3 className="roster-section__title">Stage plot</h3>
      <StagePlot
        initialConfig={seed}
        onSave={readOnly ? undefined : save}
        onConfigChange={readOnly ? undefined : save}
        readOnly={readOnly}
      />
    </div>
  );
}

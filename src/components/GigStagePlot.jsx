import { useMemo, useCallback } from 'react';
import CollapsibleSection from './CollapsibleSection.jsx';
import InfoTooltip from './InfoTooltip.jsx';
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
export default function GigStagePlot({ gigId, bandId, gig, venue, lineup, setlists, readOnly, defaultOpen = false }) {
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

  const { config, visibleToBand, setVisibleToBand, loading, error, save } = useGigStagePlot(gigId, buildSeed);

  // Stamped with the gig id so StagePlot's own identity check
  // (initialConfig !== the last one it saw) treats a genuinely different
  // gig's seed as something to load, not the same object re-rendering.
  // Memoized deliberately -- an inline object literal here gets a fresh
  // identity on every unrelated parent re-render (e.g. the tab regaining
  // focus), and StagePlot resets its whole in-progress edit back to
  // `config` whenever this prop's identity changes. That was the real
  // cause of an edit (a delete, mid-autosave-debounce) silently vanishing
  // after switching away from the app and back.
  const seed = useMemo(() => (config ? { ...config, __gigId: gigId } : null), [config, gigId]);

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

  // Automated from the roster, but not always right first time and not
  // polished enough yet for a musician-facing view -- stays hidden from
  // the band until an admin/leader has actually checked it over and
  // switched it on (see the toggle below, editable side only).
  if (readOnly && !visibleToBand) return null;

  return (
    <CollapsibleSection
      id="gig-section-stage-plot"
      title="Stage plot"
      defaultOpen={defaultOpen}
      titleExtra={<InfoTooltip text="An auto-generated stage layout from the roster — drag anything to adjust it, then choose whether musicians can see it too." />}
    >
      {!readOnly && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 13, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={visibleToBand}
            onChange={(e) => { setVisibleToBand(e.target.checked).catch(() => {}); }}
          />
          Visible to musicians
        </label>
      )}
      <StagePlot
        initialConfig={seed}
        onSave={readOnly ? undefined : save}
        onConfigChange={readOnly ? undefined : save}
        readOnly={readOnly}
      />
    </CollapsibleSection>
  );
}

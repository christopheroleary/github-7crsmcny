import { useEffect, useState } from 'react';

// Shared shell for every "Nearby X" section (food, fuel, hotels, music
// shops, car parks) -- a fold-out disclosure like the WhatsApp group setup,
// deliberately not expanded by default. These used to fetch the moment the
// gig page loaded, all five at once even when nobody was going to look at
// most of them -- the actual cause of the timeouts, not just a UI nicety.
// Nothing calls out to the map data service until a section is actually
// opened, and it's only ever fetched once per page load after that (closing
// and reopening doesn't refetch).
export default function NearbySection({ title, lat, lon, isOffline, fetchFn, children, bare = false }) {
  const [opened, setOpened] = useState(false);
  const [state, setState] = useState({ loading: false, error: null, data: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!opened || lat == null || lon == null || isOffline) return;
    const controller = new AbortController();
    setState({ loading: true, error: null, data: null });
    fetchFn(lat, lon, { signal: controller.signal })
      .then((data) => setState({ loading: false, error: null, data }))
      .catch(() => {
        // Only a real cancellation (unmount / retry / venue change) aborts this effect's own
        // controller -- an internal per-attempt timeout also throws AbortError but should surface.
        if (controller.signal.aborted) return;
        setState({ loading: false, error: "Couldn't load nearby options right now — the map data service may be busy.", data: null });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, lat, lon, isOffline, attempt]);

  if (lat == null || lon == null) return null;

  const disclosure = (
    <details onToggle={(e) => { if (e.target.open) setOpened(true); }}>
      <summary className="day-sheet__section-title" style={{ cursor: 'pointer', userSelect: 'none' }}>
        {title}
      </summary>
      <div style={{ marginTop: 10 }}>
        {isOffline && <p className="field__hint">Connect to see nearby options.</p>}
        {!isOffline && state.loading && <p className="state-message">Checking nearby options…</p>}
        {!isOffline && state.error && (
          <div>
            <p className="state-message state-message--error" style={{ padding: 0 }}>{state.error}</p>
            <button type="button" className="btn btn--ghost btn--small" style={{ marginTop: 8 }} onClick={() => setAttempt((a) => a + 1)}>
              Try again
            </button>
          </div>
        )}
        {!isOffline && state.data && children(state.data)}
      </div>
    </details>
  );

  // Nested inside NearbyPlaces.jsx's own "Key places" card, each of these
  // is a plain row rather than a second card-within-a-card -- the outer
  // wrapper below is only used for the (currently untriggered) standalone
  // case, so this component still works if used on its own elsewhere.
  if (bare) return disclosure;

  return <div className="day-sheet__section">{disclosure}</div>;
}

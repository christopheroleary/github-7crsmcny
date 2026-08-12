import { useEffect, useState } from 'react';
import { readNearbyCache, writeNearbyCache } from '../utils/nearbyCache.js';

// Shared shell for every "Nearby X" section (food, fuel, hotels, music
// shops, car parks) -- a fold-out disclosure like the WhatsApp group setup,
// deliberately not expanded by default. These used to fetch the moment the
// gig page loaded, all five at once even when nobody was going to look at
// most of them -- the actual cause of the timeouts, not just a UI nicety.
//
// Two ways data ends up here without the user opening anything:
// 1. A fresh cache entry for this venue (see nearbyCache.js) -- checked
//    synchronously on mount, so a venue visited before shows results the
//    instant the row is opened, no "Checking nearby options…" at all.
// 2. No cache yet: a quiet background fetch fires `warmDelayMs` after
//    mount, so a first-time venue is ready by the time anyone looks
//    without competing with the gig page's own data on load. Opening the
//    row manually before that timer fires just fetches immediately
//    instead, same as before this existed.
// Either way this stays invisible while the row is collapsed -- a closed
// <details> shows nothing regardless of what's loading inside it.
export default function NearbySection({ title, lat, lon, isOffline, fetchFn, children, bare = false, cacheKey, warmDelayMs = 4000 }) {
  const [opened, setOpened] = useState(false);
  const [warmed, setWarmed] = useState(false);
  const [state, setState] = useState(() => {
    const cached = cacheKey ? readNearbyCache(cacheKey, lat, lon) : null;
    return { loading: false, error: null, data: cached };
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (state.data || isOffline || lat == null || lon == null) return; // already have something to show (from cache) -- nothing to warm
    const timer = setTimeout(() => setWarmed(true), warmDelayMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lon, isOffline]);

  const shouldFetch = opened || warmed;

  useEffect(() => {
    if (!shouldFetch || state.data || lat == null || lon == null || isOffline) return;
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    fetchFn(lat, lon, { signal: controller.signal })
      .then((data) => {
        setState({ loading: false, error: null, data });
        if (cacheKey) writeNearbyCache(cacheKey, lat, lon, data);
      })
      .catch(() => {
        // Only a real cancellation (unmount / retry / venue change) aborts this effect's own
        // controller -- an internal per-attempt timeout also throws AbortError but should surface.
        if (controller.signal.aborted) return;
        setState({ loading: false, error: "Couldn't load nearby options right now — the map data service may be busy.", data: null });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldFetch, attempt, lat, lon, isOffline]);

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

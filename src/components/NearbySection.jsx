import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { readNearbyCache, writeNearbyCache } from '../utils/nearbyCache.js';

// Local cacheKey values predate (and are independent of) the DB table's
// category column, which uses underscores -- mapped here rather than
// renamed everywhere, so existing per-device localStorage cache entries
// don't all invalidate the day this shipped.
const DB_CATEGORY = { food: 'food', fuel: 'fuel', hotel: 'hotel', musicshop: 'music_shop', carpark: 'car_park' };

// Shared shell for every "Nearby X" section (food, fuel, hotels, music
// shops, car parks) -- a fold-out disclosure like the WhatsApp group setup,
// deliberately not expanded by default. These used to fetch the moment the
// gig page loaded, all five at once even when nobody was going to look at
// most of them -- the actual cause of the timeouts, not just a UI nicety.
//
// Three ways data ends up here without the user opening anything, tried in
// order, each one skipping the rest on a hit:
// 1. A fresh local cache entry for this venue (see nearbyCache.js) --
//    checked synchronously on mount, so a venue visited before on THIS
//    device shows results the instant the row is opened.
// 2. The shared server-side cache (venue_nearby_places, populated by the
//    refresh-venue-nearby-places Edge Function) -- checked right after, a
//    single fast indexed lookup. A hit here means some OTHER musician's
//    visit, or the background sweep, already paid the Overpass cost for
//    this exact venue -- this is the common case once the app's been
//    running a while, and it's what actually fixes the timeouts: nobody's
//    phone has to talk to the free Overpass mirrors at all most of the time.
// 3. Neither cache has it yet (a brand new venue, or one the sweep hasn't
//    reached): falls back to the original direct-Overpass fetch, `warmDelayMs`
//    after mount so it doesn't compete with the gig page's own data on
//    load, or immediately if the user opens the row first.
export default function NearbySection({ title, lat, lon, venueId, isOffline, fetchFn, children, bare = false, cacheKey, warmDelayMs = 4000 }) {
  const [opened, setOpened] = useState(false);
  const [warmed, setWarmed] = useState(false);
  const [checkedSharedCache, setCheckedSharedCache] = useState(false);
  const [state, setState] = useState(() => {
    const cached = cacheKey ? readNearbyCache(cacheKey, lat, lon) : null;
    return { loading: false, error: null, data: cached };
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (state.data || isOffline || lat == null || lon == null || !venueId || !cacheKey) {
      setCheckedSharedCache(true);
      return;
    }
    let cancelled = false;
    supabase
      .from('venue_nearby_places')
      .select('data')
      .eq('venue_id', venueId)
      .eq('category', DB_CATEGORY[cacheKey] || cacheKey)
      .maybeSingle()
      .then(({ data: row }) => {
        if (cancelled) return;
        if (row?.data) {
          setState({ loading: false, error: null, data: row.data });
          writeNearbyCache(cacheKey, lat, lon, row.data);
        }
        setCheckedSharedCache(true);
      })
      .catch(() => { if (!cancelled) setCheckedSharedCache(true); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId, cacheKey, lat, lon, isOffline]);

  useEffect(() => {
    if (state.data || isOffline || lat == null || lon == null || !checkedSharedCache) return; // already have something, or still waiting on the shared-cache check above
    const timer = setTimeout(() => setWarmed(true), warmDelayMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lon, isOffline, checkedSharedCache]);

  const shouldFetch = (opened || warmed) && checkedSharedCache;

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

import { useEffect, useRef, useState } from 'react';

const PULL_THRESHOLD = 70;   // px of downward drag needed to trigger a refresh
const MAX_VISUAL_PULL = 90;  // indicator stops tracking the finger 1:1 past this

/**
 * A minimal re-implementation of the native iOS/Android "pull down to
 * refresh" gesture, scoped per-page rather than global -- each caller
 * passes in whatever "refresh everything on this page" callback already
 * exists (the same one the ↻ Refresh button calls), so this just gives
 * that same callback a second, touch-native way to fire. An emergency
 * backup for the ↻ Refresh button, for exactly the situations it's meant
 * to cover -- not a replacement for the underlying per-mutation fixes.
 *
 * Deliberately window-scroll-based, not container-scroll-based: this app
 * has no independently-scrolling content container -- every page scrolls
 * the whole window (see <main> in App.jsx) -- so "at the top, free to
 * start a pull" means window.scrollY === 0, not some div's own scrollTop.
 *
 * `onRefresh` is read via a ref rather than a hook dependency, and the
 * touch listeners are attached exactly once (only re-bound if `disabled`
 * itself changes) -- both deliberately avoid tearing down and rebuilding
 * window-level listeners on every render just because the page's own
 * refresh callback identity changed.
 */
export function usePullToRefresh(onRefresh, { disabled = false } = {}) {
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(null);
  const isPulling = useRef(false);
  const isRefreshing = useRef(false);
  // Mirrors pullDistance state, read (not set) inside onTouchEnd below --
  // deliberately NOT read via setPullDistance's own updater-function form
  // there. That form runs the updater to compute the next value, but under
  // StrictMode (dev only) React invokes it TWICE to surface impurities;
  // firing onRefresh from inside it fired the refresh twice per release.
  const pullDistanceRef = useRef(0);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    if (disabled) return;

    function onTouchStart(e) {
      if (window.scrollY > 0 || isRefreshing.current) return;
      startY.current = e.touches[0].clientY;
      isPulling.current = true;
    }

    function onTouchMove(e) {
      if (!isPulling.current || startY.current == null) return;
      const delta = e.touches[0].clientY - startY.current;
      // Scrolled back up past the start point, or the page itself scrolled
      // (e.g. content grew under the finger) -- not a pull gesture anymore.
      if (delta <= 0 || window.scrollY > 0) {
        isPulling.current = false;
        startY.current = null;
        pullDistanceRef.current = 0;
        setPullDistance(0);
        return;
      }
      // Stop the browser's own rubber-band/reload-on-pull behaviour from
      // fighting with the indicator -- only once this really is a pull
      // (delta > 0 at the top), never on an ordinary scroll.
      e.preventDefault();
      const next = delta < MAX_VISUAL_PULL ? delta : MAX_VISUAL_PULL + (delta - MAX_VISUAL_PULL) * 0.2;
      pullDistanceRef.current = next;
      setPullDistance(next);
    }

    function onTouchEnd() {
      if (!isPulling.current) return;
      isPulling.current = false;
      startY.current = null;
      const finalDistance = pullDistanceRef.current;
      pullDistanceRef.current = 0;
      setPullDistance(0);
      if (finalDistance >= PULL_THRESHOLD) {
        isRefreshing.current = true;
        setRefreshing(true);
        Promise.resolve(onRefreshRef.current?.()).finally(() => {
          isRefreshing.current = false;
          setRefreshing(false);
        });
      }
    }

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [disabled]);

  return { pullDistance, refreshing, threshold: PULL_THRESHOLD };
}

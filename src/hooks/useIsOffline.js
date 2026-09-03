import { useState, useEffect, useRef } from 'react';

// Shared by every component that shows a "you're viewing what was last
// saved" banner (GigRoster, GigSetlist, Dashboard, GigTasks, GigMessages,
// MusicianClaimsAdmin, GigSuppliers, SongRequestsPanel, GigStagePlot, plus
// the two useOfflineGig*.js hooks) -- previously each hand-rolled the same
// ~10 lines, and it was easy for one to end up not actually retrying
// anything when the network came back (Dashboard and GigStagePlot both did
// this: they flipped the boolean but never re-ran their own load). Passing
// the component's own reload function in as `onReconnect` is what fixes
// that everywhere at once -- 'online' firing now always means "try again",
// not just "stop saying offline".
//
// onReconnect is read from a ref rather than the effect depending on it
// directly, so a caller can pass an inline function (or one that's
// recreated every render, e.g. a useCallback with wide deps) without this
// hook re-subscribing its listeners on every render.
export function useIsOffline(onReconnect) {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const onReconnectRef = useRef(onReconnect);
  onReconnectRef.current = onReconnect;

  useEffect(() => {
    const up = () => {
      setIsOffline(false);
      onReconnectRef.current?.();
    };
    const down = () => setIsOffline(true);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  return isOffline;
}

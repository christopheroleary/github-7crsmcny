import { useEffect, useRef } from 'react';

// Generalized version of useSwipeBack.js's gesture: fires from anywhere on
// screen (no edge-zone restriction -- useSwipeBack's is specifically for
// mimicking iOS's edge-swipe-back, which this isn't), in either direction,
// for Performance Mode's swipe-through-the-setlist navigation.
const TRIGGER_DISTANCE_PX = 60;
// Same guard as useSwipeBack -- keeps this from firing while the performer
// is scrolling a long lyric sheet vertically, which is the other gesture
// this screen needs to support without the two fighting each other.
const MAX_VERTICAL_RATIO = 0.5;

// Callbacks are read via refs (not a hook dependency) so passing a fresh
// inline function every render doesn't tear down and rebind the window
// listeners -- same reason usePullToRefresh.js does this for onRefresh.
export function useSwipeHorizontal(onSwipeLeft, onSwipeRight, { disabled = false } = {}) {
  const gestureRef = useRef(null);
  const onSwipeLeftRef = useRef(onSwipeLeft);
  const onSwipeRightRef = useRef(onSwipeRight);
  onSwipeLeftRef.current = onSwipeLeft;
  onSwipeRightRef.current = onSwipeRight;

  useEffect(() => {
    if (disabled) return;

    function handleTouchStart(e) {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      gestureRef.current = { startX: touch.clientX, startY: touch.clientY, fired: false };
    }

    function handleTouchMove(e) {
      const gesture = gestureRef.current;
      if (!gesture || gesture.fired) return;
      const touch = e.touches[0];
      const dx = touch.clientX - gesture.startX;
      const dy = Math.abs(touch.clientY - gesture.startY);
      const absDx = Math.abs(dx);
      if (absDx < TRIGGER_DISTANCE_PX) return;
      if (dy > absDx * MAX_VERTICAL_RATIO) {
        gestureRef.current = null; // drifted vertical -- reading the lyrics, not changing songs
        return;
      }
      gesture.fired = true;
      if (dx < 0) onSwipeLeftRef.current?.();
      else onSwipeRightRef.current?.();
    }

    function endGesture() {
      gestureRef.current = null;
    }

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', endGesture, { passive: true });
    window.addEventListener('touchcancel', endGesture, { passive: true });
    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', endGesture);
      window.removeEventListener('touchcancel', endGesture);
    };
  }, [disabled]);
}

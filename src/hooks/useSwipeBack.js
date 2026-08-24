import { useEffect, useRef } from 'react';

// Mimics iOS's edge-swipe-to-go-back gesture. There's no browser history to
// hook into here -- the whole app lives on one URL, navigated by React state
// rather than pushState -- so this is a from-scratch touch gesture rather
// than something riding on Safari's native back-swipe (which also isn't
// available at all once the app is running standalone as an installed PWA).
const EDGE_ZONE_PX = 24;
const TRIGGER_DISTANCE_PX = 70;
// Keeps this from firing mid vertical-scroll -- a swipe only counts once the
// horizontal travel is comfortably ahead of the vertical, not just barely.
const MAX_VERTICAL_RATIO = 0.5;

// Pass null/undefined to disable (e.g. while a nested edit form is showing
// its own separate way back, so an edge swipe shouldn't jump past it).
export function useSwipeBack(onBack) {
  const gestureRef = useRef(null);

  useEffect(() => {
    if (!onBack) return;

    function handleTouchStart(e) {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      if (touch.clientX > EDGE_ZONE_PX) return;
      gestureRef.current = { startX: touch.clientX, startY: touch.clientY, fired: false };
    }

    function handleTouchMove(e) {
      const gesture = gestureRef.current;
      if (!gesture || gesture.fired) return;
      const touch = e.touches[0];
      const dx = touch.clientX - gesture.startX;
      const dy = Math.abs(touch.clientY - gesture.startY);
      if (dx < TRIGGER_DISTANCE_PX) return;
      if (dy > dx * MAX_VERTICAL_RATIO) {
        gestureRef.current = null; // drifted vertical -- this is a scroll, not a back-swipe
        return;
      }
      gesture.fired = true;
      onBack();
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
  }, [onBack]);
}

import { useEffect } from 'react';

// The Badging API (navigator.setAppBadge/clearAppBadge) puts a number on
// the app's home-screen/taskbar icon -- the same badge iOS Mail or
// WhatsApp show. One code path covers every platform that supports it at
// all (iOS 16.4+ Safari, Chrome/Edge on Android/Windows/macOS/ChromeOS),
// all installed-PWA-only; Firefox doesn't implement it anywhere, and it's
// feature-detected below so that's a silent no-op there, not an error.
//
// This is the foreground half only -- keeps the badge accurate the instant
// unreadCount changes while the app is actually open, including the moment
// it drops back to 0 (read/cleared) since a push notification never fires
// for that. The background half -- staying accurate while the app is
// closed -- is public/sw.js's push handler, which calls the same
// setAppBadge()/clearAppBadge() from inside the push event using the
// unreadCount this app's existing Web Push payloads already carry.
export function useAppBadge(count) {
  useEffect(() => {
    if (!('setAppBadge' in navigator)) return;
    try {
      if (count > 0) {
        navigator.setAppBadge(count).catch(() => {});
      } else {
        navigator.clearAppBadge().catch(() => {});
      }
    } catch {
      // Badging API present but the call itself threw (e.g. not installed
      // as a standalone PWA on some browsers) -- badge just doesn't show.
    }
  }, [count]);
}

import { useEffect } from 'react';

// The Badging API (navigator.setAppBadge/clearAppBadge) puts a number on
// the app's home-screen/taskbar icon -- the same badge iOS Mail or
// WhatsApp show. One code path covers every platform that supports it at
// all (iOS 16.4+ Safari, Chrome/Edge on Android/Windows/macOS/ChromeOS),
// all installed-PWA-only; Firefox doesn't implement it anywhere, and it's
// feature-detected below so that's a silent no-op there, not an error.
//
// Real limitation, iOS specifically: the badge only updates while this
// code actually runs, which only happens while the PWA is open/foregrounded
// -- there's no Web Push wired up in this app (no VAPID keys, no push
// subscription, no service-worker push handler), which is the only way to
// update a badge while a PWA is closed. So the number a user sees on their
// home screen is "as of the last time they had the app open", not truly
// live -- still useful (closing the app with 3 unread leaves "3" showing
// as a reminder), just not a live background counter.
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

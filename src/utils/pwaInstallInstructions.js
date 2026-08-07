// Manual "add to home screen" steps for platforms Chrome's native
// beforeinstallprompt doesn't cover.
//
// iOS: since iOS/iPadOS 16.4, every browser there -- not just Safari -- can
// add a web app to the Home Screen from its own Share menu, because every
// iOS browser (Chrome, Edge, Firefox included) is required to run on
// Apple's WebKit engine and Apple extended the same Add-to-Home-Screen
// mechanism to all of them (see webkit.org/blog/13878, "Third-party
// browser support for Add to Home Screen"). So this is one set of steps
// for any iOS browser, not a Safari-only redirect.
// The Share icon's own location has moved around across iOS versions too
// (iOS 26 tucked it behind a "•••" button instead of showing it directly),
// so the steps mention both rather than assuming one exact layout.
export function installInstructions({ os, browser }) {
  if (os === 'iOS' || os === 'iPadOS') {
    return {
      steps: [
        'Tap the Share icon (square with an arrow ↑). If you don\'t see it, tap "•••" (more) first, then "Share".',
        'Scroll down the menu and tap "Add to Home Screen".',
        'Tap "Add".',
        'Close this browser tab, then open Gig Manager from the new icon on your Home Screen.',
      ],
      note: browser !== 'Safari'
        ? "This works from most browsers on iPhone/iPad, including this one. If \"Add to Home Screen\" doesn't appear in the share menu, try the same steps in Safari instead."
        : undefined,
    };
  }

  if (os === 'Android') {
    if (browser === 'Chrome') {
      return {
        steps: [
          'Tap the ⋮ menu in the top right of Chrome.',
          'Tap "Install app" (some versions show "Add to Home screen").',
          'Tap "Install" to confirm.',
          'Open Gig Manager from its new icon.',
        ],
      };
    }
    return {
      steps: [
        'Open the browser\'s menu (usually ⋮ or ☰).',
        'Look for "Add to Home screen" or "Install app".',
        'Confirm, then open Gig Manager from its new icon.',
      ],
    };
  }

  // Desktop
  if (browser === 'Safari') {
    return {
      steps: [
        'Open the File menu and choose "Add to Dock…".',
        'Click "Add".',
      ],
    };
  }
  if (browser === 'Firefox') {
    return {
      note: "Firefox doesn't support installing this as an app, but notifications still work fine directly in the browser — just do the next step below.",
      steps: [],
    };
  }
  // Chrome/Edge desktop fallback, for when the native install prompt isn't
  // available (e.g. already dismissed once this session).
  return {
    steps: [
      'Click the install icon (a monitor with a ↓, or a ⊕) at the right of the address bar.',
      'If you don\'t see it, open the ⋮ menu and choose "Install Gig Manager…" (Chrome) or "Apps → Install this site as an app" (Edge).',
      'Click "Install".',
    ],
  };
}

// Manual "add to home screen" steps for platforms Chrome's native
// beforeinstallprompt doesn't cover. iOS is the one that actually matters --
// every browser there (Safari, Chrome/CriOS, Firefox/FxiOS) runs on Apple's
// WebKit, and only Safari itself is allowed to install a web app to the
// Home Screen, so a non-Safari iOS browser gets redirected to open in
// Safari first rather than given steps that won't work.
export function installInstructions({ os, browser }) {
  if (os === 'iOS' || os === 'iPadOS') {
    if (browser !== 'Safari') {
      return {
        note: "On iPhone/iPad, apps can only be installed from Safari — even if you're using Chrome or another browser right now. Open this page in Safari, then come back to this step.",
        steps: [],
      };
    }
    return {
      steps: [
        'Tap the Share icon (square with an arrow pointing up) in the Safari toolbar.',
        'Scroll down the menu and tap "Add to Home Screen".',
        'Tap "Add" in the top right.',
        'Close this browser tab, then open Gig Manager from the new icon on your Home Screen.',
      ],
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

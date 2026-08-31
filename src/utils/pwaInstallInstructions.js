// Points at each platform's own official documentation instead of trying
// to maintain an in-house copy of steps that drift out of date every time
// Apple/Google/Microsoft reshuffle their UI (which is exactly what made
// the original hand-written iOS steps wrong). A short one-line summary
// stays here for a quick glance; the official link is the source of truth
// for the actual walkthrough, screenshots included.
//
function iosAppleDoc(os) {
  return os === 'iPadOS'
    ? { officialUrl: 'https://support.apple.com/guide/ipad/open-as-web-app-ipad8f1f7a29/ipados', officialLabel: 'Apple Support: Turn a website into an app (iPad)' }
    : { officialUrl: 'https://support.apple.com/guide/iphone/bookmark-a-website-iph42ab2f3a7/ios', officialLabel: 'Apple Support: Add a website to your Home Screen' };
}

// iOS: since iOS/iPadOS 16.4, every browser there -- not just Safari --
// can add a web app to the Home Screen from its own Share menu, because
// every iOS browser is required to run on Apple's WebKit engine and Apple
// extended the mechanism to third parties (webkit.org/blog/13878,
// "Third-party browser support for Add to Home Screen"). Apple's own
// iPhone/iPad guides are written from Safari's UI specifically, though --
// Chrome's share sheet on iOS has its own layout, confirmed by directly
// testing it (an extra "expand" tap Safari's doesn't need), so it gets
// its own precise steps rather than pointing at a doc written for a
// different browser's menu.
export function installInstructions({ os, browser }) {
  if (os === 'iOS' || os === 'iPadOS') {
    if (browser === 'Chrome') {
      return {
        steps: [
          'Tap the Share icon in the address bar (a square with an arrow pointing up out of it).',
          'Tap the ↓ (down arrow) in the bottom right of that menu to see more options.',
          'Scroll down to the second section — "Add to Home Screen" is the first option there.',
          'Tap "Add to Home Screen", then tap "Add" in the top right.',
        ],
        ...iosAppleDoc(os),
      };
    }
    return {
      summary: 'Share icon (or "..." then Share) → Add to Home Screen → Add.',
      note: browser !== 'Safari'
        ? "This browser's share menu may be laid out a bit differently — if you can't find \"Add to Home Screen\", the official guide below covers Safari's exact layout."
        : undefined,
      ...iosAppleDoc(os),
    };
  }

  if (os === 'ChromeOS') {
    return {
      summary: 'Address bar → install icon, or the ⋮ menu → "Install page as app".',
      officialUrl: 'https://support.google.com/chromebook/answer/9658361',
      officialLabel: 'Google Support: Use web apps on your Chromebook',
    };
  }

  if (os === 'Android') {
    if (browser === 'Chrome') {
      return {
        summary: 'Tap ⋮ (top right) → "Install app" (some versions show "Add to Home screen").',
        officialUrl: 'https://support.google.com/chrome/answer/9658361',
        officialLabel: 'Google Support: Use web apps',
      };
    }
    return {
      summary: 'Open your browser\'s menu and look for "Add to Home screen" or "Install app".',
    };
  }

  // Desktop
  if (browser === 'Safari') {
    return {
      summary: 'File menu → "Add to Dock…" (macOS Sonoma and later).',
      officialUrl: 'https://support.apple.com/guide/safari/add-to-dock-ibrw9e991864/mac',
      officialLabel: 'Apple Support: Turn a website into an app (Mac)',
    };
  }
  if (browser === 'Firefox') {
    return {
      note: "Firefox doesn't support installing this as an app, but notifications still work fine directly in the browser -- just do the next step.",
    };
  }
  if (browser === 'Edge') {
    return {
      summary: 'Settings and more (…) → Apps → "Install this site as an app".',
      officialUrl: 'https://support.microsoft.com/en-us/edge/install-manage-or-uninstall-apps-in-microsoft-edge',
      officialLabel: 'Microsoft Support: Install apps in Microsoft Edge',
    };
  }
  // Chrome desktop fallback, for when the native install prompt isn't
  // available (e.g. already dismissed once this browser session).
  return {
    summary: 'Install icon at the right of the address bar, or ⋮ menu → "Install Seeau…".',
    officialUrl: 'https://support.google.com/chrome/answer/9658361',
    officialLabel: 'Google Support: Use web apps',
  };
}

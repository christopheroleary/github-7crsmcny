let registration = null;

// Registers the service worker once, and reloads the page whenever a newly
// activated worker takes control — sw.js already calls skipWaiting() +
// clients.claim() on every install, so this is the only piece needed to
// actually put the new version in front of the user instead of it sitting
// there unused until the next full app restart.
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // The service worker's whole job is to cache the app shell so it works
  // offline -- exactly the thing that makes it fight Vite's dev server,
  // which wants every reload to fetch fresh, unbundled modules straight
  // from disk. Registering it in dev meant every restart of the dev
  // server could leave a tab silently serving a stale cached bundle
  // (import errors for exports that exist on disk, edits that never
  // appear) until someone thought to manually unregister it.
  if (import.meta.env.DEV) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => { registration = reg; })
      .catch((err) => console.warn('Service worker registration failed:', err));

    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });

    // The browser's own periodic check (and the explicit one at sign-in)
    // both miss the "left a tab open in the background all day" case --
    // easy to hit at a gig, where the app might sit backgrounded for
    // hours. Catching up the moment the tab is looked at again means
    // whatever's new (including a What's new entry) is there as soon as
    // it's plausible for someone to notice, not next reload.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkForServiceWorkerUpdate();
    });
  });
}

// Forces an immediate check for a newer sw.js instead of waiting for the
// browser's own periodic check — call this on sign-in so a stale PWA
// session gets caught up as soon as someone logs back in.
export function checkForServiceWorkerUpdate() {
  registration?.update();
}

// Full manual reset: unregisters the worker and clears every cache it made,
// then reloads. Exposed as a "Refresh app" button for anyone stuck on an
// old cached version right now, and as a permanent escape hatch.
export async function forceRefreshApp() {
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((r) => r.unregister()));
  }
  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  }
  window.location.reload();
}

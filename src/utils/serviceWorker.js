let registration = null;

// Registers the service worker once, and reloads the page whenever a newly
// activated worker takes control — sw.js already calls skipWaiting() +
// clients.claim() on every install, so this is the only piece needed to
// actually put the new version in front of the user instead of it sitting
// there unused until the next full app restart.
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

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

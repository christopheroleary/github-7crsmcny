const CACHE_NAME = 'seeau-shell-v3';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(['/']))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// hostname.includes('supabase.co') also matches a hostname like
// "supabase.co.evil.com" or "evilsupabase.co" -- includes() checks for
// the substring anywhere, not "this domain or a real subdomain of it".
// This only decides which requests bypass the service worker (still
// worth closing properly, since a hostname a page can point at isn't
// guaranteed to be one this app's own code chose), so exact-match the
// domain or require it appear as a genuine, dot-bounded subdomain.
function isOrSubdomainOf(hostname, domain) {
  return hostname === domain || hostname.endsWith('.' + domain);
}

const BYPASS_DOMAINS = ['supabase.co', 'youtube.com', 'spotify.com', 'openstreetmap.org', 'photon.komoot.io'];

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (
    BYPASS_DOMAINS.some((domain) => isOrSubdomainOf(url.hostname, domain))
    // Fonts are self-hosted under /fonts/ now (same-origin), not loaded
    // from fonts.googleapis.com/fonts.gstatic.com -- so they fall through
    // to the normal cache-first handling below like any other static
    // asset, instead of needing a bypass entry here.
  ) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok && response.type !== 'opaque') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});

// ── Push notifications ────────────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Seeau', body: event.data.text() };
  }

  // `badge` here is the small monochrome status-bar icon Chrome/Android
  // shows next to the notification text -- unrelated to `unreadCount`
  // below, which is the actual number this sets on the home-screen app
  // icon itself via the Badging API.
  const { title, body, icon, badge, tag, url, requireInteraction, unreadCount } = payload;

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title || 'Seeau', {
        body,
        icon: icon || '/icons/icon-192.png',
        badge: badge || '/icons/icon-192.png',
        tag: tag || 'seeau',
        data: { url: url || '/' },
        requireInteraction: requireInteraction || false,
        vibrate: [200, 100, 200],
      });

      // Keeps the home-screen icon badge accurate even while the app is
      // closed, since the push event is the only code that runs in that
      // state -- see useAppBadge.js for the foreground half of this (and
      // why, without this, iOS especially would only ever show "count as
      // of last time the app was open"). Feature-detected: unsupported
      // browsers (Firefox on any platform) just skip this silently.
      if (typeof unreadCount === 'number' && 'setAppBadge' in self.navigator) {
        try {
          if (unreadCount > 0) {
            await self.navigator.setAppBadge(unreadCount);
          } else {
            await self.navigator.clearAppBadge();
          }
        } catch {
          // Badging API present but the call itself threw -- badge just
          // doesn't update this time, nothing else here depends on it.
        }
      }
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
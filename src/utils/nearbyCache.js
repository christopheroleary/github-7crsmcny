// Per-venue cache for "Nearby X" results, mirroring useOfflineGigData.js's
// localStorage + timestamp pattern. Keyed by category + rounded coordinates
// rather than gig id, since the same venue gets booked repeatedly -- the
// second gig at a venue should show results instantly with zero network
// calls, not just a second visit to the same gig.
const TTL_MS = 14 * 24 * 60 * 60 * 1000; // chains/fuel stations/car parks don't change week to week, but this still self-corrects reasonably fast if one does

// ~111m precision -- treats the same venue as the same cache entry despite
// minor GPS jitter between visits, while keeping genuinely different venues
// (even fairly close ones) distinct.
function roundCoord(n) {
  return Math.round(n * 1000) / 1000;
}

function cacheKeyFor(category, lat, lon) {
  return 'nearbycache:' + category + ':' + roundCoord(lat) + ',' + roundCoord(lon);
}

export function readNearbyCache(category, lat, lon) {
  if (lat == null || lon == null) return null;
  try {
    const raw = localStorage.getItem(cacheKeyFor(category, lat, lon));
    if (!raw) return null;
    const { data, fetchedAt } = JSON.parse(raw);
    if (Date.now() - new Date(fetchedAt).getTime() > TTL_MS) return null;
    return data;
  } catch {
    return null;
  }
}

export function writeNearbyCache(category, lat, lon, data) {
  if (lat == null || lon == null) return;
  try {
    localStorage.setItem(cacheKeyFor(category, lat, lon), JSON.stringify({ data, fetchedAt: new Date().toISOString() }));
  } catch {}
}

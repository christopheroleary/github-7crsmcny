import { RADIUS_M, MAX_MINUTES, haversineKm, estimateMinutes, boundingBox, fetchOverpassElements } from './overpassPlaces.js';

const MAX_RESULTS = 3;

export async function fetchNearbyMusicShop(lat, lon, { signal } = {}) {
  const { south, west, north, east } = boundingBox(lat, lon, RADIUS_M);
  const bbox = `${south},${west},${north},${east}`;
  const query = `[out:json][timeout:20];(nwr["shop"="musical_instrument"](${bbox}););out center 200;`;
  const elements = await fetchOverpassElements(query, signal);

  const candidates = [];
  for (const el of elements) {
    const elLat = el.lat ?? el.center?.lat;
    const elLon = el.lon ?? el.center?.lon;
    if (elLat == null || elLon == null) continue;
    const distanceKm = haversineKm(lat, lon, elLat, elLon);
    const minutes = estimateMinutes(distanceKm);
    if (minutes > MAX_MINUTES) continue;
    candidates.push({
      name: el.tags?.name || el.tags?.brand || 'Music shop',
      lat: elLat,
      lon: elLon,
      distanceKm,
      minutes,
      openingHours: el.tags?.opening_hours || null,
    });
  }

  candidates.sort((a, b) => a.distanceKm - b.distanceKm);
  return candidates.slice(0, MAX_RESULTS);
}

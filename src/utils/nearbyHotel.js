import { RADIUS_M, MAX_MINUTES, haversineKm, estimateMinutes, boundingBox, fetchOverpassElements } from './overpassPlaces.js';

export const HOTEL_BRANDS = [
  { key: 'travelodge', label: 'Travelodge', pattern: /travelodge/i },
  { key: 'premierinn', label: 'Premier Inn', pattern: /premier\s*inn/i },
  { key: 'holidayinn', label: 'Holiday Inn', pattern: /holiday\s*inn/i },
  { key: 'ibis', label: 'Ibis', pattern: /\bibis\b/i },
];

export async function fetchNearbyHotel(lat, lon, { signal } = {}) {
  const { south, west, north, east } = boundingBox(lat, lon, RADIUS_M);
  const bbox = `${south},${west},${north},${east}`;
  const query = `[out:json][timeout:20];(nwr["tourism"="hotel"](${bbox}););out center 200;`;
  const elements = await fetchOverpassElements(query, signal);

  const results = {};
  for (const brand of HOTEL_BRANDS) {
    let best = null;
    for (const el of elements) {
      const name = el.tags?.name;
      if (!name || !brand.pattern.test(name)) continue;
      const elLat = el.lat ?? el.center?.lat;
      const elLon = el.lon ?? el.center?.lon;
      if (elLat == null || elLon == null) continue;
      const distanceKm = haversineKm(lat, lon, elLat, elLon);
      const minutes = estimateMinutes(distanceKm);
      if (minutes > MAX_MINUTES) continue;
      if (!best || distanceKm < best.distanceKm) {
        best = { name, lat: elLat, lon: elLon, distanceKm, minutes, openingHours: el.tags?.opening_hours || null };
      }
    }
    results[brand.key] = best;
  }
  return results;
}

import { RADIUS_M, MAX_MINUTES, haversineKm, estimateMinutes, boundingBox, fetchOverpassElements, parseOpeningHours } from './overpassPlaces.js';

const MAX_RESULTS = 3;

function carParkName(tags) {
  return tags?.name || tags?.operator || 'Car park';
}

export async function fetchNearbyCarPark(lat, lon, { signal } = {}) {
  const { south, west, north, east } = boundingBox(lat, lon, RADIUS_M);
  const bbox = `${south},${west},${north},${east}`;
  const query = `[out:json][timeout:20];(nwr["amenity"="parking"](${bbox}););out center 200;`;
  const elements = await fetchOverpassElements(query, signal);

  const candidates = [];
  for (const el of elements) {
    const elLat = el.lat ?? el.center?.lat;
    const elLon = el.lon ?? el.center?.lon;
    if (elLat == null || elLon == null) continue;
    const distanceKm = haversineKm(lat, lon, elLat, elLon);
    const minutes = estimateMinutes(distanceKm);
    if (minutes > MAX_MINUTES) continue;
    const openingHours = el.tags?.opening_hours || null;
    candidates.push({
      name: carParkName(el.tags),
      lat: elLat,
      lon: elLon,
      distanceKm,
      minutes,
      openingHours,
      // Most car parks in OSM simply have no opening_hours tag at all, whether
      // or not they're actually barrier-free and open round the clock -- this
      // only ever claims 24/7 when the data explicitly says so, same as fuel.
      isAlwaysOpen: parseOpeningHours(openingHours).always === true,
    });
  }

  // 24-hour car parks first (most useful for a late-finishing gig), then by distance within each group.
  candidates.sort((a, b) => (b.isAlwaysOpen - a.isAlwaysOpen) || (a.distanceKm - b.distanceKm));
  return candidates.slice(0, MAX_RESULTS);
}

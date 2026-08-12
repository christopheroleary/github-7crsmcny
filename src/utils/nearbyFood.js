import { RADIUS_M, MAX_MINUTES, haversineKm, estimateMinutes, boundingBox, fetchOverpassElements } from './overpassPlaces.js';

export const FOOD_BRANDS = [
  { key: 'mcdonalds', label: "McDonald's", pattern: /mcdonald/i },
  { key: 'burgerking', label: 'Burger King', pattern: /burger\s*king/i },
  { key: 'nandos', label: "Nando's", pattern: /nando/i },
  { key: 'tobycarvery', label: 'Toby Carvery', pattern: /toby\s*carvery/i },
  // Matched only against amenity=fast_food/restaurant and shop=supermarket/
  // convenience elements below -- a railway/underground station is tagged
  // entirely differently in OSM (railway=station, not a shop or amenity),
  // so it can never end up in this result set regardless of its name.
  { key: 'subway', label: 'Subway', pattern: /subway/i },
  { key: 'pizzaexpress', label: 'Pizza Express', pattern: /pizza\s*express/i },
  { key: 'tesco', label: 'Tesco', pattern: /tesco/i },
  { key: 'asda', label: 'Asda', pattern: /asda/i },
];

export async function fetchNearbyFood(lat, lon, { signal } = {}) {
  // A case-insensitive name regex times out the public Overpass servers over this large an
  // area — exact amenity/shop tag matches are cheap, so filter to our brands client-side
  // instead. Supermarket + convenience shop types are included alongside the food amenities
  // so Tesco/Asda (including their smaller Express-format stores) show up at all.
  const { south, west, north, east } = boundingBox(lat, lon, RADIUS_M);
  const bbox = `${south},${west},${north},${east}`;
  const query = `[out:json][timeout:20];(nwr["amenity"="fast_food"](${bbox});nwr["amenity"="restaurant"](${bbox});nwr["shop"="supermarket"](${bbox});nwr["shop"="convenience"](${bbox}););out center 200;`;
  const elements = await fetchOverpassElements(query, signal);

  const results = {};
  for (const brand of FOOD_BRANDS) {
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

import { RADIUS_M, MAX_MINUTES, haversineKm, estimateMinutes, boundingBox, fetchOverpassElements, parseOpeningHours } from './overpassPlaces.js';

const MAX_RESULTS = 3;

// Car parks with no restaurant/hotel-style "brand" to fall back on are
// disproportionately unnamed in OSM -- rather than showing three identical
// "Car park" rows with nothing to tell them apart, fall back through
// whatever descriptive tags the data does have: the physical type (multi-
// storey, underground, etc.), then just "Car park".
const PARKING_TYPE_LABELS = {
  'multi-storey': 'Multi-storey car park',
  underground: 'Underground car park',
  rooftop: 'Rooftop car park',
  street_side: 'Street parking',
  surface: 'Car park',
  lane: 'Street parking',
};

function carParkName(tags) {
  if (tags?.name) return tags.name;
  if (tags?.operator) return tags.operator;
  return PARKING_TYPE_LABELS[tags?.parking] || 'Car park';
}

// yes/no/discretionary/etc, per the OSM fee key -- shown as a quick "will I
// need change/an app for this" hint alongside distance and hours.
function feeLabel(tags) {
  if (tags?.fee === 'no') return 'Free';
  if (tags?.fee === 'yes') return 'Pay & display';
  if (tags?.fee === 'discretionary' || tags?.fee === 'donation') return 'Donation';
  return null;
}

// Excludes only explicit restricted-access tags -- most public car parks
// have no `access` tag at all, and absence must not be treated as
// "private" or every untagged (i.e. most) car park would vanish.
function isPubliclyUsable(tags) {
  const access = tags?.access;
  return !access || !['private', 'customers', 'no', 'permit'].includes(access);
}

export async function fetchNearbyCarPark(lat, lon, { signal } = {}) {
  const { south, west, north, east } = boundingBox(lat, lon, RADIUS_M);
  const bbox = `${south},${west},${north},${east}`;
  const query = `[out:json][timeout:20];(nwr["amenity"="parking"](${bbox}););out center 200;`;
  const elements = await fetchOverpassElements(query, signal);

  const candidates = [];
  for (const el of elements) {
    const tags = el.tags || {};
    if (!isPubliclyUsable(tags)) continue; // customer-only/private lots aren't a real option for a band turning up
    const elLat = el.lat ?? el.center?.lat;
    const elLon = el.lon ?? el.center?.lon;
    if (elLat == null || elLon == null) continue;
    const distanceKm = haversineKm(lat, lon, elLat, elLon);
    const minutes = estimateMinutes(distanceKm);
    if (minutes > MAX_MINUTES) continue;
    const openingHours = tags.opening_hours || null;
    candidates.push({
      name: carParkName(tags),
      lat: elLat,
      lon: elLon,
      distanceKm,
      minutes,
      openingHours,
      // Most car parks in OSM simply have no opening_hours tag at all, whether
      // or not they're actually barrier-free and open round the clock -- this
      // only ever claims 24/7 when the data explicitly says so, same as fuel.
      isAlwaysOpen: parseOpeningHours(openingHours).always === true,
      fee: feeLabel(tags),
      capacity: tags.capacity ? Number(tags.capacity) || null : null,
    });
  }

  // 24-hour car parks first (most useful for a late-finishing gig), then by distance within each group.
  candidates.sort((a, b) => (b.isAlwaysOpen - a.isAlwaysOpen) || (a.distanceKm - b.distanceKm));
  return candidates.slice(0, MAX_RESULTS);
}

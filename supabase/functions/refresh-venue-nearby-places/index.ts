import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── Ported from src/utils/overpassPlaces.js -- same geometry/mirror/retry
// logic, run here instead of on a musician's phone at the venue. Kept
// behaviourally identical (same radius, same two mirrors, same 20s-per-
// attempt timeout, same single backed-off retry) so results match what the
// client used to compute for itself. ──────────────────────────────────────
const MAX_MINUTES = 20;
const ROUTE_FACTOR = 1.3;
const AVG_SPEED_KMH = 40;
const RADIUS_M = Math.round(((MAX_MINUTES / 60) * AVG_SPEED_KMH * 1000) / ROUTE_FACTOR);

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimateMinutes(distanceKm: number): number {
  return Math.round(((distanceKm * ROUTE_FACTOR) / AVG_SPEED_KMH) * 60);
}

function boundingBox(lat: number, lon: number, radiusM = RADIUS_M) {
  const latD = radiusM / 111320;
  const lonD = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
  return { south: lat - latD, west: lon - lonD, north: lat + latD, east: lon + lonD };
}

// The full client-side opening_hours parser (src/utils/overpassPlaces.js)
// handles arbitrary "opens at X" display at render time from the raw
// string, which still happens client-side against the viewer's own clock
// -- all this needs server-side is the one signal used for sort order.
function isAlwaysOpen(raw: string | null): boolean {
  return Boolean(raw && /^24\/7$/i.test(raw.trim()));
}

const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
// Shorter than the client's own 20s/5s -- an Edge Function invocation has
// its own platform-imposed wall-clock ceiling, and 5 categories each
// getting a full 20s-timeout-plus-5s-backoff-plus-20s-retry (up to 45s)
// can blow through that ceiling on a single bad venue, aborting every
// category's fetch outright rather than just that one slow query.
const ATTEMPT_TIMEOUT_MS = 12000;
const RETRY_BACKOFF_MS = 2000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, body: string): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ATTEMPT_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: 'POST',
      body,
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'GigManagerNearbyPlaces/1.0',
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOverpassElementsOnePass(query: string): Promise<any[]> {
  const body = 'data=' + encodeURIComponent(query);
  let lastErr = new Error('Overpass request failed');
  for (const url of ENDPOINTS) {
    try {
      const res = await fetchWithTimeout(url, body);
      if (!res.ok) {
        lastErr = new Error('Overpass request failed (' + res.status + ')');
        continue;
      }
      const json = await res.json();
      return json.elements || [];
    } catch (e) {
      lastErr = e as Error;
    }
  }
  throw lastErr;
}

async function fetchOverpassElements(query: string): Promise<any[]> {
  try {
    return await fetchOverpassElementsOnePass(query);
  } catch {
    await delay(RETRY_BACKOFF_MS);
    return await fetchOverpassElementsOnePass(query);
  }
}

// ── Ported from src/utils/nearbyFood.js / nearbyFuel.js / nearbyHotel.js /
// nearbyMusicShop.js / nearbyCarPark.js -- same tag filters, same brand
// lists, same result shape the client components already know how to
// render (children(state.data) in NearbySection.jsx), so nothing on the
// rendering side needs to change, only where the data comes from. ─────────
const FOOD_BRANDS = [
  { key: 'mcdonalds', pattern: /mcdonald/i },
  { key: 'burgerking', pattern: /burger\s*king/i },
  { key: 'nandos', pattern: /nando/i },
  { key: 'tobycarvery', pattern: /toby\s*carvery/i },
  { key: 'subway', pattern: /subway/i },
  { key: 'pizzaexpress', pattern: /pizza\s*express/i },
  { key: 'tesco', pattern: /tesco/i },
  { key: 'asda', pattern: /asda/i },
];

const HOTEL_BRANDS = [
  { key: 'travelodge', pattern: /travelodge/i },
  { key: 'premierinn', pattern: /premier\s*inn/i },
  { key: 'holidayinn', pattern: /holiday\s*inn/i },
  { key: 'ibis', pattern: /\bibis\b/i },
];

const PARKING_TYPE_LABELS: Record<string, string> = {
  'multi-storey': 'Multi-storey car park',
  underground: 'Underground car park',
  rooftop: 'Rooftop car park',
  street_side: 'Street parking',
  surface: 'Car park',
  lane: 'Street parking',
};

function elCoords(el: any): [number, number] | null {
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  return lat == null || lon == null ? null : [lat, lon];
}

function bestByBrand(elements: any[], brands: { key: string; pattern: RegExp }[], lat: number, lon: number) {
  const results: Record<string, any> = {};
  for (const brand of brands) {
    let best: any = null;
    for (const el of elements) {
      const name = el.tags?.name;
      if (!name || !brand.pattern.test(name)) continue;
      const coords = elCoords(el);
      if (!coords) continue;
      const distanceKm = haversineKm(lat, lon, coords[0], coords[1]);
      const minutes = estimateMinutes(distanceKm);
      if (minutes > MAX_MINUTES) continue;
      if (!best || distanceKm < best.distanceKm) {
        best = { name, lat: coords[0], lon: coords[1], distanceKm, minutes, openingHours: el.tags?.opening_hours || null };
      }
    }
    results[brand.key] = best;
  }
  return results;
}

async function fetchFood(lat: number, lon: number) {
  const { south, west, north, east } = boundingBox(lat, lon);
  const bbox = `${south},${west},${north},${east}`;
  const query = `[out:json][timeout:20];(nwr["amenity"="fast_food"](${bbox});nwr["amenity"="restaurant"](${bbox});nwr["shop"="supermarket"](${bbox});nwr["shop"="convenience"](${bbox}););out center 200;`;
  return bestByBrand(await fetchOverpassElements(query), FOOD_BRANDS, lat, lon);
}

async function fetchHotel(lat: number, lon: number) {
  const { south, west, north, east } = boundingBox(lat, lon);
  const bbox = `${south},${west},${north},${east}`;
  const query = `[out:json][timeout:20];(nwr["tourism"="hotel"](${bbox}););out center 200;`;
  return bestByBrand(await fetchOverpassElements(query), HOTEL_BRANDS, lat, lon);
}

async function fetchFuel(lat: number, lon: number) {
  const { south, west, north, east } = boundingBox(lat, lon);
  const bbox = `${south},${west},${north},${east}`;
  const query = `[out:json][timeout:20];(nwr["amenity"="fuel"](${bbox}););out center 200;`;
  const elements = await fetchOverpassElements(query);
  const candidates: any[] = [];
  for (const el of elements) {
    const coords = elCoords(el);
    if (!coords) continue;
    const distanceKm = haversineKm(lat, lon, coords[0], coords[1]);
    const minutes = estimateMinutes(distanceKm);
    if (minutes > MAX_MINUTES) continue;
    const openingHours = el.tags?.opening_hours || null;
    candidates.push({
      name: el.tags?.name || el.tags?.brand || el.tags?.operator || 'Fuel station',
      lat: coords[0], lon: coords[1], distanceKm, minutes, openingHours,
      isAlwaysOpen: isAlwaysOpen(openingHours),
    });
  }
  candidates.sort((a, b) => (Number(b.isAlwaysOpen) - Number(a.isAlwaysOpen)) || (a.distanceKm - b.distanceKm));
  return candidates.slice(0, 3);
}

async function fetchMusicShop(lat: number, lon: number) {
  const { south, west, north, east } = boundingBox(lat, lon);
  const bbox = `${south},${west},${north},${east}`;
  const query = `[out:json][timeout:20];(nwr["shop"="musical_instrument"](${bbox}););out center 200;`;
  const elements = await fetchOverpassElements(query);
  const candidates: any[] = [];
  for (const el of elements) {
    const coords = elCoords(el);
    if (!coords) continue;
    const distanceKm = haversineKm(lat, lon, coords[0], coords[1]);
    const minutes = estimateMinutes(distanceKm);
    if (minutes > MAX_MINUTES) continue;
    candidates.push({
      name: el.tags?.name || el.tags?.brand || 'Music shop',
      lat: coords[0], lon: coords[1], distanceKm, minutes, openingHours: el.tags?.opening_hours || null,
    });
  }
  candidates.sort((a, b) => a.distanceKm - b.distanceKm);
  return candidates.slice(0, 3);
}

function carParkName(tags: any): string {
  if (tags?.name) return tags.name;
  if (tags?.operator) return tags.operator;
  return PARKING_TYPE_LABELS[tags?.parking] || 'Car park';
}

function feeLabel(tags: any): string | null {
  if (tags?.fee === 'no') return 'Free';
  if (tags?.fee === 'yes') return 'Pay & display';
  if (tags?.fee === 'discretionary' || tags?.fee === 'donation') return 'Donation';
  return null;
}

function isPubliclyUsable(tags: any): boolean {
  const access = tags?.access;
  return !access || !['private', 'customers', 'no', 'permit'].includes(access);
}

async function fetchCarPark(lat: number, lon: number) {
  const { south, west, north, east } = boundingBox(lat, lon);
  const bbox = `${south},${west},${north},${east}`;
  const query = `[out:json][timeout:20];(nwr["amenity"="parking"](${bbox}););out center 200;`;
  const elements = await fetchOverpassElements(query);
  const candidates: any[] = [];
  for (const el of elements) {
    const tags = el.tags || {};
    if (!isPubliclyUsable(tags)) continue;
    const coords = elCoords(el);
    if (!coords) continue;
    const distanceKm = haversineKm(lat, lon, coords[0], coords[1]);
    const minutes = estimateMinutes(distanceKm);
    if (minutes > MAX_MINUTES) continue;
    const openingHours = tags.opening_hours || null;
    candidates.push({
      name: carParkName(tags), lat: coords[0], lon: coords[1], distanceKm, minutes, openingHours,
      isAlwaysOpen: isAlwaysOpen(openingHours),
      fee: feeLabel(tags),
      capacity: tags.capacity ? Number(tags.capacity) || null : null,
    });
  }
  candidates.sort((a, b) => (Number(b.isAlwaysOpen) - Number(a.isAlwaysOpen)) || (a.distanceKm - b.distanceKm));
  return candidates.slice(0, 3);
}

const CATEGORY_FETCHERS: Record<string, (lat: number, lon: number) => Promise<any>> = {
  food: fetchFood,
  fuel: fetchFuel,
  hotel: fetchHotel,
  music_shop: fetchMusicShop,
  car_park: fetchCarPark,
};

// A small gap between categories, not zero -- but kept short deliberately.
// Category queries run sequentially within one invocation anyway (that's
// already enough spacing to not look like a burst to Overpass), and every
// millisecond spent waiting here eats into the same wall-clock ceiling the
// tightened timeouts above are trying to stay under.
async function refreshVenue(venueId: string, lat: number, lon: number): Promise<{ venueId: string; ok: boolean; error?: string }> {
  try {
    for (const [category, fetcher] of Object.entries(CATEGORY_FETCHERS)) {
      const data = await fetcher(lat, lon);
      const { error } = await supabase
        .from('venue_nearby_places')
        .upsert({ venue_id: venueId, category, data, fetched_at: new Date().toISOString() }, { onConflict: 'venue_id,category' });
      if (error) throw error;
      await delay(400);
    }
    return { venueId, ok: true };
  } catch (err: any) {
    // supabase-js throws plain PostgrestError objects, not real Error
    // instances -- String(err) on those gives the useless "[object Object]"
    // rather than the actual message, which is exactly what happened while
    // debugging this live.
    return { venueId, ok: false, error: err?.message || err?.error_description || String(err) };
  }
}

const TTL_MS = 14 * 24 * 60 * 60 * 1000;
// One venue per invocation -- discovered live that 3 venues x 5 categories
// with generous per-attempt timeouts genuinely exceeded the Edge Function
// platform's own wall-clock limit and aborted every in-flight request, not
// just a slow one. The cron schedule (every 10 minutes) supplies the
// pacing across venues instead of doing it inside one long invocation.
const SWEEP_BATCH_SIZE = 1;
const SWEEP_HORIZON_DAYS = 60;
const VENUE_GAP_MS = 400;

Deno.serve(async (req) => {
  try {
    let body: any = {};
    try { body = await req.json(); } catch { /* sweep mode: no body */ }

    // Single-venue mode -- called by VenueForm right after saving a venue
    // with fresh coordinates, so a brand-new venue doesn't have to wait for
    // the next sweep before it's cached for whoever's first on a gig there.
    if (body.venue_id) {
      const { data: venue, error } = await supabase
        .from('venues')
        .select('id, latitude, longitude')
        .eq('id', body.venue_id)
        .single();
      if (error) throw error;
      if (venue.latitude == null || venue.longitude == null) {
        return new Response(JSON.stringify({ ok: true, skipped: 'venue has no coordinates' }), { headers: { 'Content-Type': 'application/json' } });
      }
      const result = await refreshVenue(venue.id, venue.latitude, venue.longitude);
      return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
    }

    // Sweep mode -- cron-invoked. Venues with an upcoming, non-cancelled gig
    // in the next 60 days whose cache is missing or older than the 14-day
    // TTL, so a venue is warm well before anyone's actually there checking
    // it on the day, not just the next time someone happens to save it.
    const horizon = new Date(Date.now() + SWEEP_HORIZON_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);

    const { data: upcomingGigs, error: gigsError } = await supabase
      .from('gigs')
      .select('venue_id, venues!inner(id, latitude, longitude)')
      .gte('gig_date', today)
      .lte('gig_date', horizon)
      .neq('status', 'cancelled')
      .not('venue_id', 'is', null);
    if (gigsError) throw gigsError;

    const venueMap = new Map<string, { lat: number; lon: number }>();
    for (const row of upcomingGigs || []) {
      const v = (row as any).venues;
      if (v?.latitude != null && v?.longitude != null) venueMap.set(v.id, { lat: v.latitude, lon: v.longitude });
    }

    const cutoff = new Date(Date.now() - TTL_MS).toISOString();
    const staleVenueIds: string[] = [];
    for (const venueId of venueMap.keys()) {
      const { data: rows } = await supabase
        .from('venue_nearby_places')
        .select('category, fetched_at')
        .eq('venue_id', venueId);
      const byCategory = new Set((rows || []).map((r) => r.category));
      const isStale = byCategory.size < 5 || (rows || []).some((r) => r.fetched_at < cutoff);
      if (isStale) staleVenueIds.push(venueId);
      if (staleVenueIds.length >= SWEEP_BATCH_SIZE) break;
    }

    const results = [];
    for (const venueId of staleVenueIds) {
      const { lat, lon } = venueMap.get(venueId)!;
      results.push(await refreshVenue(venueId, lat, lon));
      await delay(VENUE_GAP_MS);
    }

    return new Response(JSON.stringify({ ok: true, candidateVenues: venueMap.size, refreshed: results }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('refresh-venue-nearby-places error:', err);
    return new Response(JSON.stringify({ error: err?.message || String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});

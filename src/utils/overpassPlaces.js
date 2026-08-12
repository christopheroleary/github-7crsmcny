export const MAX_MINUTES = 20;
const ROUTE_FACTOR = 1.3; // real roads are longer than a straight line
const AVG_SPEED_KMH = 40; // local A/B roads with junctions, not motorway
// Furthest straight-line distance that could still be a <20 min drive after the route factor.
export const RADIUS_M = Math.round(((MAX_MINUTES / 60) * AVG_SPEED_KMH * 1000) / ROUTE_FACTOR);

export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function estimateMinutes(distanceKm) {
  return Math.round(((distanceKm * ROUTE_FACTOR) / AVG_SPEED_KMH) * 60);
}

export function boundingBox(lat, lon, radiusM = RADIUS_M) {
  const latD = radiusM / 111320;
  const lonD = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
  return { south: lat - latD, west: lon - lonD, north: lat + latD, east: lon + lonD };
}

function formatMinutesOfDay(mins) {
  const m = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}

const DAY_MAP = { Su: 0, Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5, Sa: 6 };
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Parses a subset of the OSM opening_hours spec — plain weekday/time rules only.
// Anything with public-holiday or seasonal-month tokens is reported as unsupported
// so we show the raw text instead of risking a wrong open/closed claim.
export function parseOpeningHours(raw, now = new Date()) {
  if (!raw) return { supported: false, raw: null };
  const trimmed = raw.trim();
  if (/^24\/7$/i.test(trimmed)) {
    return { supported: true, raw: trimmed, isOpen: true, always: true, closesAt: null, opensAt: null };
  }
  if (/(PH|SH|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|week)/i.test(trimmed)) {
    return { supported: false, raw: trimmed };
  }

  const dayRanges = [[], [], [], [], [], [], []];
  const dayTokenRe = /^[A-Za-z]{2}(-[A-Za-z]{2})?(,[A-Za-z]{2}(-[A-Za-z]{2})?)*$/;
  const rules = trimmed.split(';').map((r) => r.trim()).filter(Boolean);

  for (const rule of rules) {
    const parts = rule.split(/\s+/);
    let days;
    let timeStr;

    if (dayTokenRe.test(parts[0])) {
      days = [];
      for (const tok of parts[0].split(',')) {
        if (tok.includes('-')) {
          const [a, b] = tok.split('-');
          if (!(a in DAY_MAP) || !(b in DAY_MAP)) return { supported: false, raw: trimmed };
          let d = DAY_MAP[a];
          const end = DAY_MAP[b];
          while (true) {
            days.push(d);
            if (d === end) break;
            d = (d + 1) % 7;
          }
        } else {
          if (!(tok in DAY_MAP)) return { supported: false, raw: trimmed };
          days.push(DAY_MAP[tok]);
        }
      }
      timeStr = parts.slice(1).join(' ');
    } else {
      days = [0, 1, 2, 3, 4, 5, 6];
      timeStr = parts.join(' ');
    }

    if (/^off$/i.test(timeStr)) {
      for (const d of days) dayRanges[d] = [];
      continue;
    }

    const parsedSegs = [];
    for (const seg of timeStr.split(',').map((s) => s.trim())) {
      const m = seg.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
      if (!m) return { supported: false, raw: trimmed };
      const startMin = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
      let endMin = parseInt(m[3], 10) * 60 + parseInt(m[4], 10);
      if (endMin === 0) endMin = 1440;
      parsedSegs.push([startMin, endMin]);
    }

    for (const d of days) {
      const todayRanges = [];
      const nd = (d + 1) % 7;
      const carry = [];
      for (const [s, e] of parsedSegs) {
        if (e > s) {
          todayRanges.push([s, e]);
        } else {
          todayRanges.push([s, 1440]);
          carry.push([0, e]);
        }
      }
      dayRanges[d] = todayRanges;
      if (carry.length) dayRanges[nd] = (dayRanges[nd] || []).concat(carry);
    }
  }

  const dayIdx = now.getDay();
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const todays = dayRanges[dayIdx] || [];
  const activeRange = todays.find(([s, e]) => minutesNow >= s && minutesNow < e);

  if (activeRange) {
    return { supported: true, raw: trimmed, isOpen: true, closesAt: formatMinutesOfDay(activeRange[1]), opensAt: null };
  }

  const laterToday = todays.find(([s]) => s > minutesNow);
  let opensAt = null;
  let opensDayLabel = null;
  if (laterToday) {
    opensAt = formatMinutesOfDay(laterToday[0]);
  } else {
    for (let i = 1; i <= 7; i++) {
      const d = (dayIdx + i) % 7;
      const ranges = dayRanges[d];
      if (ranges && ranges.length) {
        opensAt = formatMinutesOfDay(ranges[0][0]);
        opensDayLabel = DAY_LABELS[d];
        break;
      }
    }
  }

  return { supported: true, raw: trimmed, isOpen: false, closesAt: null, opensAt, opensDayLabel };
}

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const ATTEMPT_TIMEOUT_MS = 20000;

async function fetchWithTimeout(url, body, parentSignal) {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  parentSignal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => ctrl.abort(), ATTEMPT_TIMEOUT_MS);
  try {
    return await fetch(url, { method: 'POST', body, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', onAbort);
  }
}

async function fetchOverpassElementsOnePass(query, signal) {
  const body = 'data=' + encodeURIComponent(query);
  let lastErr = new Error('Overpass request failed');
  for (const url of ENDPOINTS) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      const res = await fetchWithTimeout(url, body, signal);
      if (!res.ok) {
        lastErr = new Error('Overpass request failed (' + res.status + ')');
        lastErr.status = res.status;
        continue;
      }
      const json = await res.json();
      return json.elements || [];
    } catch (e) {
      if (signal?.aborted) throw e;
      lastErr = e;
    }
  }
  throw lastErr;
}

const RETRY_BACKOFF_MS = 5000;

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

// One full pass already tries both mirrors -- but on a day (like today's
// testing) where both are actively rate-limited, that first pass fails
// immediately and every "Nearby X" section reports "busy" even though the
// limit often clears within a few seconds, not minutes. A single backed-off
// retry recovers most of those transient windows without the user needing
// to notice anything or click "Try again" themselves -- this applies
// uniformly whether the request came from a background warm-up or someone
// manually opening a row, since both go through this same function.
async function fetchOverpassElementsInner(query, signal) {
  try {
    return await fetchOverpassElementsOnePass(query, signal);
  } catch (firstErr) {
    if (signal?.aborted) throw firstErr;
    await delay(RETRY_BACKOFF_MS, signal);
    return await fetchOverpassElementsOnePass(query, signal);
  }
}

// The free Overpass mirrors above are shared, rate-limited public servers --
// every "Nearby X" section on a gig page (food, fuel, hotels, music shops,
// car parks) queries them independently, and if two of those sections
// happen to fire at the same moment (e.g. two fold-outs opened within the
// same render) the servers throttle or time out both requests instead of
// just queueing them. This module-level chain forces every call anywhere
// in the app to run one at a time, in the order they were requested,
// regardless of which component or section they came from -- the same
// fix a single component can't provide on its own since it has no way to
// know what any *other* component is doing at the same moment.
let queue = Promise.resolve();
export function fetchOverpassElements(query, signal) {
  const run = () => fetchOverpassElementsInner(query, signal);
  const result = queue.then(run, run);
  queue = result.then(
    () => {},
    () => {} // a failed request still frees the queue for the next one
  );
  return result;
}

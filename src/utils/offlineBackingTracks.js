import { supabase } from '../supabaseClient';

// Per-device offline copies of backing tracks -- deliberately separate
// from the service worker's own cache (sw.js bypasses every supabase.co
// request entirely, so it never accidentally caches a signed URL or
// stale API response). This is a dedicated, user-initiated store: someone
// taps "Save for offline" on one specific track (the first dance, say),
// and only that file's actual audio bytes get kept on this device.
const CACHE_NAME = 'seeau-backing-tracks-v1';
const MANIFEST_KEY = 'seeau_offline_backing_tracks';
// "Until the day after the gig" -- kept through the whole day after, gone
// by the one after that. A track saved outside any specific gig context
// (no gigId) is left alone rather than guessed at.
const RETENTION_DAYS_AFTER_GIG = 2;

// A stable key independent of the signed URL playback normally fetches
// through -- that carries an expiring token and is different every time
// one's requested, so it can't double as a lookup key for "do we already
// have this". The storage bucket path (file_url) never changes for a
// given track, so that's what both saving and looking up key off.
function cacheKeyFor(track) {
  return 'https://offline.seeau.local/backing-tracks/' + encodeURIComponent(track.file_url);
}

function readManifest() {
  try {
    return JSON.parse(localStorage.getItem(MANIFEST_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeManifest(manifest) {
  try { localStorage.setItem(MANIFEST_KEY, JSON.stringify(manifest)); } catch { /* private browsing etc -- just won't persist across reloads */ }
}

export function isTrackOffline(trackId) {
  return Boolean(readManifest()[trackId]);
}

// Reconstructs a track list from what's actually been saved for this
// song, for the case the real network fetch in BackingTrackPlayer.jsx
// fails (offline) -- so a track saved for exactly this reason still shows
// up and is playable, instead of the whole list coming back empty.
export function listOfflineTracksForSong(bandId, songId) {
  return Object.values(readManifest())
    .filter((e) => e.bandId === bandId && e.songId === songId)
    .map((e) => e.track);
}

// fetchBytes: () => Promise<ArrayBuffer> -- the caller already knows how
// to sign+fetch a track (BackingTrackPlayer.jsx's loadTrack), reused here
// rather than duplicating that.
export async function saveTrackOffline(track, { bandId, songId, gigId }, fetchBytes) {
  const arrayBuffer = await fetchBytes();
  const cache = await caches.open(CACHE_NAME);
  await cache.put(cacheKeyFor(track), new Response(arrayBuffer, { headers: { 'Content-Type': 'audio/mpeg' } }));

  const manifest = readManifest();
  manifest[track.id] = { track, bandId, songId, gigId: gigId || null, cachedAt: new Date().toISOString() };
  writeManifest(manifest);
}

export async function getOfflineTrackBytes(track) {
  const cache = await caches.open(CACHE_NAME);
  const match = await cache.match(cacheKeyFor(track));
  return match ? match.arrayBuffer() : null;
}

export async function removeTrackOffline(track) {
  const cache = await caches.open(CACHE_NAME);
  await cache.delete(cacheKeyFor(track));
  const manifest = readManifest();
  delete manifest[track.id];
  writeManifest(manifest);
}

// Called once on app load. Looks up the real gig date for every offline
// track tagged with one (a single batched query, not one per track) and
// evicts anything whose gig has passed by more than
// RETENTION_DAYS_AFTER_GIG -- so a phone doesn't quietly keep accumulating
// last month's first-dance tracks. Offline-first on purpose: if the
// lookup itself fails (no signal), this just skips silently and tries
// again next load rather than erroring -- there's no urgency to evict
// anything while offline anyway.
export async function sweepExpiredOfflineTracks() {
  const manifest = readManifest();
  const entries = Object.entries(manifest);
  const gigIds = [...new Set(entries.map(([, e]) => e.gigId).filter(Boolean))];
  if (gigIds.length === 0) return;

  try {
    const { data: gigs, error } = await supabase.from('gigs').select('id, gig_date').in('id', gigIds);
    if (error) return;
    const dateByGigId = Object.fromEntries((gigs || []).map((g) => [g.id, g.gig_date]));

    const cache = await caches.open(CACHE_NAME);
    const now = Date.now();
    let changed = false;
    for (const [trackId, entry] of entries) {
      const gigDate = entry.gigId ? dateByGigId[entry.gigId] : null;
      if (!gigDate) continue; // gig itself no longer exists, or was never gig-scoped -- leave it
      const expiresAt = new Date(gigDate).getTime() + RETENTION_DAYS_AFTER_GIG * 86400000;
      if (now > expiresAt) {
        await cache.delete(cacheKeyFor(entry.track));
        delete manifest[trackId];
        changed = true;
      }
    }
    if (changed) writeManifest(manifest);
  } catch {
    // Offline, or some other transient failure -- try again next load.
  }
}

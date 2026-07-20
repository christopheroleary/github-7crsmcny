import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';

// ─── Constants ────────────────────────────────────────────────────────────────

const LIST_KEY = (isAdmin, showHistoric) =>
  `gigcache:list:${isAdmin ? 'admin' : 'member'}:${showHistoric ? 'all' : 'upcoming'}`;
const GIG_KEY = (gigId) => 'gigcache:' + gigId;
const PRECACHE_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

// ─── Cache helpers ────────────────────────────────────────────────────────────

function readListCache(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeListCache(key, gigs) {
  try {
    localStorage.setItem(key, JSON.stringify({ gigs, synced_at: new Date().toISOString() }));
  } catch {}
}

function readGigCache(gigId) {
  try {
    const raw = localStorage.getItem(GIG_KEY(gigId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeGigCache(gigId, data) {
  try {
    localStorage.setItem(GIG_KEY(gigId), JSON.stringify({ ...data, synced_at: new Date().toISOString() }));
  } catch {}
}

function getKnownCachedIds() {
  try {
    return Object.keys(localStorage)
      .filter((k) => k.startsWith('gigcache:') && !k.startsWith('gigcache:list'))
      .map((k) => k.replace('gigcache:', ''));
  } catch {
    return [];
  }
}

const today = () => new Date().toISOString().slice(0, 10);

const in30Days = () =>
  new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

// ─── Network fetchers ─────────────────────────────────────────────────────────

/**
 * Fetches the gig list.
 * - isAdmin: uses admin select fields (fee_amount, clients) and sees all gigs
 * - band_member: uses member fields, filtered to their lineup only.
 *   Also fetches musician_claims and merges `claim_status` onto each gig so
 *   GigsList can filter for unclaimed past gigs without a separate query.
 * - showHistoric: when true, removes the date floor (matches GigsList behaviour)
 */
async function fetchGigList({ isAdmin, profileId, showHistoric }) {
  const adminFields = 'id, gig_date, start_time, status, fee_amount, venues(name), clients(name), bands(name)';
  const memberFields = 'id, gig_date, start_time, status, venues(name), bands(name)';

  if (isAdmin) {
    let query = supabase
      .from('gigs')
      .select(adminFields)
      .order('gig_date', { ascending: true });

    if (!showHistoric) {
      query = query.gte('gig_date', today());
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data || [];
  }

  // band_member — find their lineup gig IDs first
  const { data: lineupRows, error: lineupError } = await supabase
    .from('gig_lineup')
    .select('gig_id')
    .eq('profile_id', profileId);

  if (lineupError) throw new Error(lineupError.message);

  const gigIds = (lineupRows || []).map((r) => r.gig_id);
  if (gigIds.length === 0) return [];

  let query = supabase
    .from('gigs')
    .select(memberFields)
    .in('id', gigIds)
    .order('gig_date', { ascending: true });

  if (!showHistoric) {
    query = query.gte('gig_date', today());
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const fetchedGigIds = (data || []).map((g) => g.id);
  if (fetchedGigIds.length === 0) return [];

  // ── Merge musician claim status onto each gig ──────────────────────────────
  // Fetched separately because claim rows live in musician_claims, not gigs.
  // null claim_status = no claim submitted yet; 'pending' / 'rejected' = not
  // yet settled. GigsList filters on 'approved' | 'paid' to hide settled gigs.
  const { data: claims } = await supabase
    .from('musician_claims')
    .select('gig_id, status')
    .eq('profile_id', profileId)
    .in('gig_id', fetchedGigIds);

  const claimMap = Object.fromEntries(
    (claims || []).map((c) => [c.gig_id, c.status])
  );

  return (data || []).map((g) => ({
    ...g,
    claim_status: claimMap[g.id] ?? null,
  }));
}

/** Full detail fetch for a single gig — used for background pre-caching. */
async function fetchGigData(gigId) {
  const [
    { data: gigData, error: gigError },
    { data: lineupData },
    { data: setlistLinks },
  ] = await Promise.all([
    supabase
      .from('gigs')
      .select(
        'id, gig_date, start_time, end_time, load_in_time, soundcheck_time, status, parking_notes, notes, fee_amount, mileage_rate_pence, band_id, venues(name, address, latitude, longitude), bands(name), clients(name)'
      )
      .eq('id', gigId)
      .single(),

    supabase
      .from('gig_lineup')
      .select(
        'id, profile_id, placeholder_id, confirmed, instrument_id, travel_cost_pence, vocal_role, profiles(full_name), instruments(name), placeholder_musicians(name)'
      )
      .eq('gig_id', gigId),

    supabase
      .from('gig_setlists')
      .select(
        'setlists(id, name, setlist_items(id, position, songs(id, title, artist, original_key, lyrics, reference_url)))'
      )
      .eq('gig_id', gigId),
  ]);

  if (gigError) throw new Error(gigError.message);

  const setlists = (setlistLinks || [])
    .map((l) => l.setlists)
    .filter(Boolean)
    .map((sl) => ({
      ...sl,
      setlist_items: [...(sl.setlist_items || [])].sort((a, b) => a.position - b.position),
    }));

  return { gig: gigData, lineup: lineupData || [], setlists };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * useOfflineGigList
 *
 * Drop-in replacement for the inline fetch logic in GigsList.jsx.
 *
 * - Matches the exact select fields GigsList already uses per role
 * - Respects the showHistoric toggle (no 30-day cap when historic is shown)
 * - Serves cached list instantly on mount for zero loading flash
 * - When online: fetches fresh list then quietly pre-caches every gig's full
 *   detail in the background (300ms stagger, skips recently cached gigs)
 * - Exposes cachedGigIds so the UI can dim/disable uncached rows when offline
 * - For band members, merges `claim_status` from musician_claims onto each gig
 *
 * Usage:
 *   const {
 *     gigs, isOffline, syncing, syncedAt, cachedGigIds, error, refresh
 *   } = useOfflineGigList({ isAdmin, profileId: me?.id, showHistoric });
 */
export function useOfflineGigList({ isAdmin, profileId, showHistoric }) {
  const cacheKey = LIST_KEY(isAdmin, showHistoric);
  const cached = readListCache(cacheKey);

  const [gigs, setGigs] = useState(cached?.gigs || []);
  const [syncedAt, setSyncedAt] = useState(cached?.synced_at || null);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);
  const [cachedGigIds, setCachedGigIds] = useState(getKnownCachedIds);

  const activeRef = useRef(true);

  // ── Online / offline listeners ──────────────────────────────────────────────
  useEffect(() => {
    const up = () => setIsOffline(false);
    const down = () => setIsOffline(true);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  // ── Background pre-cacher ───────────────────────────────────────────────────
  const preCacheGigs = useCallback(async (gigList) => {
    // Only pre-cache upcoming gigs (no point caching past ones)
    const upcoming = gigList.filter((g) => g.gig_date >= today());

    for (const gig of upcoming) {
      if (!activeRef.current || !navigator.onLine) break;

      const existing = readGigCache(gig.id);
      if (existing?.synced_at) {
        const age = Date.now() - new Date(existing.synced_at).getTime();
        if (age < PRECACHE_MAX_AGE_MS) continue;
      }

      try {
        const data = await fetchGigData(gig.id);
        writeGigCache(gig.id, data);
        if (activeRef.current) {
          setCachedGigIds((prev) => (prev.includes(gig.id) ? prev : [...prev, gig.id]));
        }
      } catch {
        // Non-fatal — skip this gig and carry on
      }

      await new Promise((res) => setTimeout(res, 300));
    }
  }, []);

  // ── Main refresh ────────────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    if (!navigator.onLine) return;
    setSyncing(true);
    setError(null);

    try {
      const freshGigs = await fetchGigList({ isAdmin, profileId, showHistoric });
      writeListCache(cacheKey, freshGigs);

      if (activeRef.current) {
        setGigs(freshGigs);
        setSyncedAt(new Date().toISOString());
      }

      // Fire-and-forget — don't block the list render
      preCacheGigs(freshGigs);
    } catch (err) {
      if (activeRef.current) setError(err.message);
    } finally {
      if (activeRef.current) setSyncing(false);
    }
  }, [isAdmin, profileId, showHistoric, cacheKey, preCacheGigs]);

  // ── Re-fetch when showHistoric or role changes (mirrors GigsList's useEffect) ─
  useEffect(() => {
    activeRef.current = true;

    // Paint from cache immediately
    const freshCache = readListCache(cacheKey);
    if (freshCache?.gigs) setGigs(freshCache.gigs);

    if (navigator.onLine) {
      refresh();
    } else if (!freshCache?.gigs?.length) {
      setError(
        isAdmin
          ? 'No cached gigs found. Open the app while online to save your gig list for offline use.'
          : 'No cached gigs found. Open the app while online at least once to save your upcoming gigs.'
      );
    }

    return () => {
      activeRef.current = false;
    };
  }, [cacheKey, refresh, isAdmin]);

  return {
    gigs,         // Gig list (from cache or network), same shape as before
    isOffline,    // True when device has no connection
    syncing,      // True while fetching from Supabase
    syncedAt,     // ISO string of last successful sync
    cachedGigIds, // String[] — gig IDs with full offline detail cached
    error,
    refresh,
  };
}
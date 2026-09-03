import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { todayStr } from '../utils/formatDate.js';
import { useIsOffline } from './useIsOffline.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const LIST_KEY = (isAdmin, showHistoric) =>
  `gigcache:list:${isAdmin ? 'admin' : 'member'}:${showHistoric ? 'all' : 'upcoming'}`;
const GIG_KEY = (gigId) => 'gigcache:' + gigId;
const PRECACHE_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour
const PRECACHE_CONCURRENCY = 3;

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

// Exported for BandLeaderGigGrid, which needs to read the same per-gig
// cache entries this file's background precacher already populates,
// rather than maintaining a second grid-specific cache.
export function readGigCache(gigId) {
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

// Walks localStorage keys by index rather than materialising the whole
// key list via Object.keys(localStorage), which on some browsers reads every
// value as well. This runs synchronously on the main thread during mount, so
// on a device with a lot of cached gigs the difference is visible as a stall
// before first paint.
export function getKnownCachedIds() {
  try {
    const ids = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('gigcache:') && !k.startsWith('gigcache:list')) {
        ids.push(k.slice('gigcache:'.length));
      }
    }
    return ids;
  } catch {
    return [];
  }
}

const today = todayStr;

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
  // band_id (not just the joined bands(name)) is needed client-side to work
  // out whether the current viewer actually manages THIS gig's band, vs the
  // blanket admin/leader flag -- see GigsList.jsx's canManageGig().
  const adminFields = 'id, gig_date, start_time, status, fee_amount, notes, needs_dj, needs_roadie, band_id, venues(name), clients(name), bands(name)';
  const memberFields = 'id, gig_date, start_time, status, notes, venues(name), bands(name)';

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

    const fetchedGigIds = (data || []).map((g) => g.id);
    if (fetchedGigIds.length === 0) return [];

    // ── Enrichment queries ──────────────────────────────────────────────────
    // All four depend only on fetchedGigIds and not on each other, so they go
    // out together. Previously this was three sequential awaits (invoices,
    // then claims, then a Promise.all for the roster pair) = four serial
    // round trips to build one list, which on a mobile connection is roughly
    // half a second of dead time before anything reaches the screen.
    const [
      { data: invoices },
      { data: claims },
      { data: requirements },
      { data: lineup },
    ] = await Promise.all([
      supabase.from('invoices').select('gig_id, status').in('gig_id', fetchedGigIds),
      supabase.from('musician_claims').select('gig_id, status').in('gig_id', fetchedGigIds).eq('status', 'pending'),
      supabase.from('gig_requirements').select('gig_id, instrument_id, quantity').in('gig_id', fetchedGigIds),
      // profile_id/confirmed/fee_pence/travel_cost_pence added so a band
      // leader (who always takes this admin branch, even for gigs they're
      // merely performing on) gets their own confirmation status and fee
      // back too -- previously only the plain-musician branch below
      // computed these, so a leader saw the full client-facing gig fee for
      // every gig regardless of whether they actually managed it.
      supabase.from('gig_lineup').select('gig_id, profile_id, confirmed, fee_pence, travel_cost_pence, instrument_id, is_dj, is_roadie').in('gig_id', fetchedGigIds),
    ]);

    // ── Merge invoice status onto each gig ──────────────────────────────────
    // null invoice_status = no invoice created yet; 'draft'/'overdue' = unsettled.
    // GigsList filters on 'sent' | 'paid' to hide settled gigs.
    // If a gig ever has multiple invoices, the most advanced status wins.
    const STATUS_PRIORITY = { paid: 4, sent: 3, overdue: 2, draft: 1 };
    const invoiceMap = {};
    for (const inv of (invoices || [])) {
      const existing = invoiceMap[inv.gig_id];
      if (!existing || (STATUS_PRIORITY[inv.status] ?? 0) > (STATUS_PRIORITY[existing] ?? 0)) {
        invoiceMap[inv.gig_id] = inv.status;
      }
    }

    // ── Merge "has a pending musician claim" onto each gig ──────────────────
    // pending = submitted but admin hasn't approved, paid, or rejected it yet.
    const pendingClaimGigIds = new Set((claims || []).map((c) => c.gig_id));

    // ── Merge "roster incomplete" onto each gig ─────────────────────────────
    // Incomplete = nobody booked at all, or a required instrument is short.

    const lineupCountByGig = {};
    const filledByGigInstrument = {};
    const djFilledByGig = {};
    const roadieFilledByGig = {};
    // Left undefined for a gig the viewer isn't personally on at all (a pure
    // admin, or a leader who only manages this one) -- GigsList.jsx checks
    // `=== false` specifically so "not on this gig" never reads as "needs
    // to confirm", only an explicit unconfirmed row does.
    const myConfirmedByGig = {};
    // Same "undefined means not on this gig" convention as myConfirmedByGig
    // -- these are the viewer's own agreed fee/travel, never the client-
    // facing gig total, for a gig they're merely performing on.
    const myFeeByGig = {};
    const myTravelByGig = {};
    for (const l of (lineup || [])) {
      lineupCountByGig[l.gig_id] = (lineupCountByGig[l.gig_id] || 0) + 1;
      const key = l.gig_id + '|' + l.instrument_id;
      filledByGigInstrument[key] = (filledByGigInstrument[key] || 0) + 1;
      if (l.is_dj) djFilledByGig[l.gig_id] = true;
      if (l.is_roadie) roadieFilledByGig[l.gig_id] = true;
      if (l.profile_id === profileId) {
        myConfirmedByGig[l.gig_id] = l.confirmed;
        myFeeByGig[l.gig_id] = l.fee_pence;
        myTravelByGig[l.gig_id] = l.travel_cost_pence;
      }
    }
    const requirementsByGig = {};
    for (const r of (requirements || [])) {
      (requirementsByGig[r.gig_id] ||= []).push(r);
    }
    const needsByGig = {};
    for (const g of (data || [])) {
      needsByGig[g.id] = { needs_dj: g.needs_dj, needs_roadie: g.needs_roadie };
    }
    const incompleteRosterGigIds = new Set();
    for (const gigId of fetchedGigIds) {
      if (!lineupCountByGig[gigId]) {
        incompleteRosterGigIds.add(gigId);
        continue;
      }
      const reqs = requirementsByGig[gigId] || [];
      const short = reqs.some((r) => (filledByGigInstrument[gigId + '|' + r.instrument_id] || 0) < r.quantity);
      const needs = needsByGig[gigId] || {};
      const missingDj = needs.needs_dj && !djFilledByGig[gigId];
      const missingRoadie = needs.needs_roadie && !roadieFilledByGig[gigId];
      if (short || missingDj || missingRoadie) incompleteRosterGigIds.add(gigId);
    }

    return (data || []).map((g) => ({
      ...g,
      invoice_status: invoiceMap[g.id] ?? null,
      has_pending_claim: pendingClaimGigIds.has(g.id),
      roster_incomplete: incompleteRosterGigIds.has(g.id),
      my_confirmed: myConfirmedByGig[g.id],
      my_fee_pence: myFeeByGig[g.id],
      my_travel_cost_pence: myTravelByGig[g.id],
    }));
  }

  // band_member — find their lineup gig IDs first.
  // The claims query only ever filters by profile_id, so it does not actually
  // depend on the gig ids and can go out in the same round trip rather than
  // waiting behind the gigs query. Any claim rows for gigs outside this list
  // simply never get looked up below. 3 serial round trips -> 2.
  const [
    { data: lineupRows, error: lineupError },
    { data: claims },
  ] = await Promise.all([
    supabase.from('gig_lineup').select('gig_id, confirmed').eq('profile_id', profileId),
    supabase.from('musician_claims').select('gig_id, status').eq('profile_id', profileId),
  ]);

  if (lineupError) throw new Error(lineupError.message);

  const gigIds = (lineupRows || []).map((r) => r.gig_id);
  if (gigIds.length === 0) return [];

  const confirmedMap = Object.fromEntries(
    (lineupRows || []).map((r) => [r.gig_id, r.confirmed])
  );

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
  // Claims were fetched in parallel above; build the lookup here.
  // null claim_status = no claim submitted yet; 'pending' / 'rejected' = not
  // yet settled. GigsList filters on 'approved' | 'paid' to hide settled gigs.
  const claimMap = Object.fromEntries(
    (claims || []).map((c) => [c.gig_id, c.status])
  );

  return (data || []).map((g) => ({
    ...g,
    claim_status: claimMap[g.id] ?? null,
    my_confirmed: confirmedMap[g.id] ?? false,
  }));
}

/**
 * Full detail fetch for a single gig — used for background pre-caching.
 *
 * is_captain/is_dj/is_roadie on lineup and needs_dj/needs_roadie/requirements
 * exist purely for BandLeaderGigGrid's offline mode — no other consumer of
 * this cache entry needs them, but they're cheap to carry and keeping one
 * canonical per-gig cache entry (rather than a second cache Grid maintains
 * itself) means the same background precache walk that already keeps
 * List/Calendar's offline data warm covers Grid for free.
 */
async function fetchGigData(gigId) {
  const [
    { data: gigData, error: gigError },
    { data: lineupData },
    { data: requirementsData },
    { data: setlistLinks },
  ] = await Promise.all([
    supabase
      .from('gigs')
      .select(
        'id, gig_date, start_time, end_time, load_in_time, soundcheck_time, status, parking_notes, notes, fee_amount, mileage_rate_pence, band_id, needs_dj, needs_roadie, venues(name, address, latitude, longitude), bands(name), clients(name)'
      )
      .eq('id', gigId)
      .single(),

    supabase
      .from('gig_lineup')
      .select(
        'id, profile_id, placeholder_id, confirmed, instrument_id, travel_cost_pence, vocal_role, is_captain, is_dj, is_roadie, profiles(full_name), instruments(name), placeholder_musicians(name)'
      )
      .eq('gig_id', gigId),

    supabase
      .from('gig_requirements')
      .select('gig_id, quantity, instruments(name)')
      .eq('gig_id', gigId),

    supabase
      .from('gig_setlists')
      .select(
        'setlists(id, name, setlist_items(id, position, songs(id, title, artist, original_key, bpm, lyrics, reference_url)))'
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

  return { gig: gigData, lineup: lineupData || [], requirements: requirementsData || [], setlists };
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
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);
  const [cachedGigIds, setCachedGigIds] = useState(getKnownCachedIds);

  const activeRef = useRef(true);

  // ── Background pre-cacher ───────────────────────────────────────────────────
  // Runs a small number of fetches at a time rather than strictly one after
  // another with a fixed 300ms sleep between each. The old shape meant ~20
  // upcoming gigs held the connection for roughly 10 seconds, and 50 for
  // nearly half a minute, competing the whole time with whatever the user was
  // actually tapping. Bounded concurrency finishes the same work sooner and
  // hands the network back sooner, which is what the foreground actually
  // cares about. PRECACHE_CONCURRENCY is deliberately low so this stays
  // background work and doesn't saturate a weak venue connection.
  const preCacheGigs = useCallback(async (gigList) => {
    // Only pre-cache upcoming gigs (no point caching past ones)
    const queue = gigList.filter((g) => {
      if (g.gig_date < today()) return false;
      const existing = readGigCache(g.id);
      if (existing?.synced_at) {
        const age = Date.now() - new Date(existing.synced_at).getTime();
        if (age < PRECACHE_MAX_AGE_MS) return false;
      }
      return true;
    });

    let cursor = 0;
    async function worker() {
      while (cursor < queue.length) {
        if (!activeRef.current || !navigator.onLine) return;
        const gig = queue[cursor++];
        try {
          const data = await fetchGigData(gig.id);
          writeGigCache(gig.id, data);
          if (activeRef.current) {
            setCachedGigIds((prev) => (prev.includes(gig.id) ? prev : [...prev, gig.id]));
          }
        } catch {
          // Non-fatal — skip this gig and carry on
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(PRECACHE_CONCURRENCY, queue.length) }, worker)
    );
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

  // Re-fetches the list the moment connectivity returns -- without this, a
  // list opened while offline keeps showing that stale snapshot (e.g. a gig
  // someone else just confirmed, or an invoice that got paid) until this
  // component happens to unmount/remount.
  const isOffline = useIsOffline(refresh);

  // ── Claim-updated listener ──────────────────────────────────────────────────
  // MusicianClaim dispatches 'claim-updated' after a successful save so the list
  // cache (which holds claim_status per gig) is refreshed immediately, keeping
  // the "Unpaid claims" filter in sync without a manual page reload.
  // Must be declared after `refresh` to avoid a temporal dead zone error.
  useEffect(() => {
    function handleClaimUpdated() {
      if (navigator.onLine) refresh();
    }
    window.addEventListener('claim-updated', handleClaimUpdated);
    return () => window.removeEventListener('claim-updated', handleClaimUpdated);
  }, [refresh]);

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
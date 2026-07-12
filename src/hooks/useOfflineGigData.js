import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';

// ─── Cache helpers ────────────────────────────────────────────────────────────

const KEY = (gigId) => 'gigcache:' + gigId;

function readCache(gigId) {
  try {
    const raw = localStorage.getItem(KEY(gigId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCache(gigId, data) {
  try {
    localStorage.setItem(KEY(gigId), JSON.stringify({ ...data, synced_at: new Date().toISOString() }));
  } catch {}
}

// ─── Network fetcher ──────────────────────────────────────────────────────────

/**
 * Fetches all fields needed by both GigDetail (admin) and GigDetailBandMember.
 * Includes fee_amount, mileage_rate_pence, band_id so GigDetail renders fully.
 * Also fetches gig_requirements for GigDetail's instruments-needed section.
 */
async function fetchGigData(gigId) {
  const [
    { data: gigData, error: gigError },
    { data: lineupData },
    { data: setlistLinks },
    { data: requirementsData },
  ] = await Promise.all([
    supabase
      .from('gigs')
      .select(
        '*, venues(name, address, latitude, longitude), clients(name), bands(name)'
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

    supabase
      .from('gig_requirements')
      .select('quantity, instruments(name)')
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

  return {
    gig: gigData,
    lineup: lineupData || [],
    setlists,
    requirements: requirementsData || [],
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * useOfflineGigData
 *
 * Works for both GigDetail (admin) and GigDetailBandMember (band_member).
 * Returns all fields both components need, including requirements for GigDetail.
 *
 * If useOfflineGigList has pre-cached this gig in the background, this hook
 * will find it immediately and render with zero loading state.
 *
 * Usage:
 *   const { gig, lineup, setlists, requirements, isOffline, syncing, syncedAt, error, refresh } =
 *     useOfflineGigData(gigId);
 */
export function useOfflineGigData(gigId) {
  const [data, setData] = useState(() => readCache(gigId));
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);
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

  // ── Refresh from network ────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    if (!navigator.onLine) return;
    setSyncing(true);
    setError(null);
    try {
      const fetched = await fetchGigData(gigId);
      writeCache(gigId, fetched);
      if (activeRef.current) {
        setData({ ...fetched, synced_at: new Date().toISOString() });
      }
    } catch (err) {
      if (activeRef.current) setError(err.message);
    } finally {
      if (activeRef.current) setSyncing(false);
    }
  }, [gigId]);

  // ── Boot ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    activeRef.current = true;

    const cached = readCache(gigId);
    if (cached) setData(cached);

    if (navigator.onLine) {
      refresh();
    } else if (!cached) {
      setError(
        'This gig isn\'t available offline. Open the gig list while online — your upcoming gigs will be saved automatically.'
      );
    }

    return () => { activeRef.current = false; };
  }, [gigId, refresh]);

  return {
    gig: data?.gig || null,
    lineup: data?.lineup || [],
    setlists: data?.setlists || [],
    requirements: data?.requirements || [], // needed by GigDetail
    syncedAt: data?.synced_at || null,
    isOffline,
    syncing,
    error,
    refresh,
  };
}
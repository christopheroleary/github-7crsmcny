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
        '*, venues(id, name, address, latitude, longitude), clients(name), bands(name), songs:first_dance_song_id(title, artist)'
      )
      .eq('id', gigId)
      .single(),

    // `phone` is deliberately NOT selected here. Embedding it pulled every
    // lineup member's number into state and into the offline localStorage
    // cache regardless of their share_phone_on_daysheet setting, which made
    // that toggle cosmetic -- the number was on the device either way. The
    // get_gig_roster_phones RPC below returns numbers only for members who
    // opted in, so an opted-out number never reaches the client at all.
    supabase
      .from('gig_lineup')
      .select(
        'id, profile_id, placeholder_id, confirmed, instrument_id, travel_cost_pence, lift_share, vocal_role, is_captain, is_dj, is_roadie, fee_pence, confirmed_fee_pence, profiles(full_name, share_phone_on_daysheet, avatar_url), instruments(name), placeholder_musicians(name)'
      )
      .eq('gig_id', gigId),

    supabase
      .from('gig_setlists')
      .select(
        'setlists(id, name, setlist_items(id, position, songs(id, title, artist, original_key, bpm, lyrics, reference_url)))'
      )
      .eq('gig_id', gigId),

    supabase
      .from('gig_requirements')
      .select('quantity, instruments(name)')
      .eq('gig_id', gigId),
  ]);

  if (gigError) throw new Error(gigError.message);

  // Merge in only the numbers whose owner opted into sharing. Failing this
  // call must not break the gig view -- a day sheet without phone numbers is
  // still perfectly usable, and this runs on flaky venue connections -- so
  // an error here degrades to "no numbers shown" rather than throwing.
  let lineupWithPhones = lineupData || [];
  try {
    const { data: phones } = await supabase.rpc('get_gig_roster_phones', { p_gig_id: gigId });
    if (phones?.length) {
      const byProfile = new Map(phones.map((r) => [r.profile_id, r.phone]));
      lineupWithPhones = lineupWithPhones.map((l) =>
        byProfile.has(l.profile_id)
          ? { ...l, profiles: { ...l.profiles, phone: byProfile.get(l.profile_id) } }
          : l
      );
    }
  } catch {
    // Leave the lineup as-is; no numbers rendered.
  }

  const setlists = (setlistLinks || [])
    .map((l) => l.setlists)
    .filter(Boolean)
    .map((sl) => ({
      ...sl,
      setlist_items: [...(sl.setlist_items || [])].sort((a, b) => a.position - b.position),
    }));

  return {
    gig: gigData,
    lineup: lineupWithPhones,
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

  // ── Online / offline listeners ──────────────────────────────────────────────
  // Re-fetches the moment connectivity returns -- without this, a gig opened
  // while offline (serving cached data) stays on that stale snapshot until
  // the component happens to unmount/remount, even though the network is
  // back and fresher data is one query away. Declared after `refresh` so it
  // can call it directly.
  useEffect(() => {
    const up = () => { setIsOffline(false); refresh(); };
    const down = () => setIsOffline(true);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, [refresh]);

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
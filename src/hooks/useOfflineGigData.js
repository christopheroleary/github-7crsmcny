import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';

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
    localStorage.setItem(KEY(gigId), JSON.stringify({
      ...data,
      synced_at: new Date().toISOString(),
    }));
  } catch {
    // localStorage full — fail silently
  }
}

async function fetchGigData(gigId) {
  const [{ data: gigData, error: gigError }, { data: lineupData }, { data: setlistLinks }] =
    await Promise.all([
      supabase
        .from('gigs')
        .select([
          'id', 'gig_date', 'start_time', 'end_time',
          'load_in_time', 'soundcheck_time', 'status',
          'parking_notes', 'notes',
          'venues(name, address, latitude, longitude)',
          'bands(name)',
          'clients(name)',
        ].join(', '))
        .eq('id', gigId)
        .single(),

      supabase
        .from('gig_lineup')
        .select('id, profile_id, confirmed, instrument_id, travel_cost_pence, profiles(full_name), instruments(name), placeholder_id, placeholder_musicians(name)')
        .eq('gig_id', gigId),

      supabase
        .from('gig_setlists')
        .select('setlists(id, name, setlist_items(id, position, songs(id, title, artist, original_key, lyrics, reference_url)))')
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
  };
}

export function useOfflineGigData(gigId) {
  const [data, setData] = useState(() => readCache(gigId));
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);
  const activeRef = useRef(true);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!navigator.onLine) return;
    setSyncing(true);
    setError(null);
    try {
      const fetched = await fetchGigData(gigId);
      writeCache(gigId, fetched);
      if (activeRef.current) setData({ ...fetched, synced_at: new Date().toISOString() });
    } catch (err) {
      if (activeRef.current) setError(err.message);
    } finally {
      if (activeRef.current) setSyncing(false);
    }
  }, [gigId]);

  useEffect(() => {
    activeRef.current = true;

    // Load from cache immediately for instant display
    const cached = readCache(gigId);
    if (cached) setData(cached);

    if (navigator.onLine) {
      refresh();
    } else if (!cached) {
      setError('No cached data found for this gig. You need to view this gig while online at least once to save it for offline use.');
    }

    return () => {
      activeRef.current = false;
    };
  }, [gigId, refresh]);

  return {
    gig: data?.gig || null,
    lineup: data?.lineup || [],
    setlists: data?.setlists || [],
    syncedAt: data?.synced_at || null,
    isOffline,
    syncing,
    error,
    refresh,
  };
}
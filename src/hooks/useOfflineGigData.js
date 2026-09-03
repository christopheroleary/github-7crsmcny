import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { useIsOffline } from './useIsOffline.js';

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
 *
 * Also fetches six lighter, per-section datasets purely so GigMessages,
 * GigTasks, MusicianClaimsAdmin, GigSuppliers, SongRequestsPanel, and
 * GigStagePlot have something real to fall back to when their own live
 * query fails offline -- same idea as the roster/setlist cache above, just
 * for the rest of the gig page. All six are plain text/small JSON (no
 * images -- gig photos are deliberately NOT cached here, that's real data),
 * and each mirrors that component's own existing select() so the cached
 * shape is a drop-in match for what it already expects. None of the six is
 * allowed to fail the whole gig load -- same resilience pattern as the
 * phone RPC below, missing chat/tasks/etc. offline is a real limitation but
 * not one that should also take out the roster and setlist.
 */
async function fetchGigData(gigId) {
  const [
    { data: gigData, error: gigError },
    { data: lineupData },
    { data: setlistLinks },
    { data: requirementsData },
    { data: messagesData },
    { data: tasksData },
    { data: claimsData },
    { data: suppliersData },
    { data: songRequestsData },
    { data: stagePlotData },
  ] = await Promise.all([
    supabase
      .from('gigs')
      .select(
        '*, venues(id, name, address, latitude, longitude, stage_width_m, stage_depth_m, has_stage_riser), clients(name), bands(name), songs:first_dance_song_id(title, artist)'
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

    // Same select as GigMessages.jsx's own load() -- reactions are fetched
    // separately below since they key off the message ids this returns.
    supabase
      .from('gig_messages')
      .select('id, sender_id, body, created_at, sender:profiles(full_name)')
      .eq('gig_id', gigId)
      .order('created_at', { ascending: true })
      .limit(200)
      .then((res) => res, () => ({ data: [] })),

    // Same select as GigTasks.jsx's own load().
    supabase
      .from('tasks')
      .select('id, title, due_date, done')
      .eq('gig_id', gigId)
      .eq('done', false)
      .order('due_date', { ascending: true, nullsFirst: false })
      .then((res) => res, () => ({ data: [] })),

    // Same select as MusicianClaimsAdmin.jsx's own load().
    supabase
      .from('musician_claims')
      .select('*, profiles(full_name, stripe_connect_status), placeholder_musicians(name), musician_claim_items(*)')
      .eq('gig_id', gigId)
      .order('created_at')
      .then((res) => res, () => ({ data: [] })),

    // Same select as GigSuppliers.jsx's own loadAttached() -- the separate
    // "worked together before" prior-gig count it also computes is a small
    // nicety, not essential to reading the list offline, so it's not
    // duplicated here.
    supabase
      .from('gig_suppliers')
      .select('id, person_met_on_site, supplier_id, suppliers(*)')
      .eq('gig_id', gigId)
      .order('created_at')
      .then((res) => res, () => ({ data: [] })),

    // Same select as SongRequestsPanel.jsx's own load().
    supabase
      .from('song_requests')
      .select('*, songs(title, artist)')
      .eq('gig_id', gigId)
      .then((res) => res, () => ({ data: [] })),

    // Same select as useGigStagePlot.js's own load().
    supabase
      .from('gig_stage_plots')
      .select('config, visible_to_band')
      .eq('gig_id', gigId)
      .maybeSingle()
      .then((res) => res, () => ({ data: null })),
  ]);

  if (gigError) throw new Error(gigError.message);

  // Reactions key off the message ids just fetched, so this can't join the
  // Promise.all above -- kept best-effort like everything else here rather
  // than letting a reactions-table hiccup drop the messages themselves.
  let reactionsData = [];
  const messageIds = (messagesData || []).map((m) => m.id);
  if (messageIds.length > 0) {
    try {
      const { data } = await supabase
        .from('gig_message_reactions')
        .select('message_id, profile_id')
        .in('message_id', messageIds);
      reactionsData = data || [];
    } catch {
      // Leave reactions empty -- messages themselves still cache fine.
    }
  }

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
    messages: messagesData || [],
    reactions: reactionsData,
    tasks: tasksData || [],
    claims: claimsData || [],
    suppliers: suppliersData || [],
    songRequests: songRequestsData || [],
    stagePlot: stagePlotData || null,
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
 *   const {
 *     gig, lineup, setlists, requirements,
 *     messages, reactions, tasks, claims, suppliers, songRequests, stagePlot,
 *     isOffline, syncing, syncedAt, error, refresh,
 *   } = useOfflineGigData(gigId);
 */
export function useOfflineGigData(gigId) {
  const [data, setData] = useState(() => readCache(gigId));
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

  // Re-fetches the moment connectivity returns -- without this, a gig opened
  // while offline (serving cached data) stays on that stale snapshot until
  // the component happens to unmount/remount, even though the network is
  // back and fresher data is one query away.
  const isOffline = useIsOffline(refresh);

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
    // The six below are each a fallback for one section's own live query --
    // see the matching cached<X> prop on GigMessages/GigTasks/
    // MusicianClaimsAdmin/GigSuppliers/SongRequestsPanel/GigStagePlot.
    messages: data?.messages || [],
    reactions: data?.reactions || [],
    tasks: data?.tasks || [],
    claims: data?.claims || [],
    suppliers: data?.suppliers || [],
    songRequests: data?.songRequests || [],
    stagePlot: data?.stagePlot || null,
    syncedAt: data?.synced_at || null,
    isOffline,
    syncing,
    error,
    refresh,
  };
}
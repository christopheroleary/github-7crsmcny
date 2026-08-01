import { createContext, useContext, useEffect, useState, useRef } from 'react';
import { supabase } from '../supabaseClient';

const ProfileContext = createContext(null);

// Cache the resolved profile so reopening the app with no signal doesn't
// hang forever waiting on a network request — see loadProfile() below.
const PROFILE_CACHE_KEY = 'gig_manager_profile_cache';

function readCachedProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCachedProfile(profile, ledBandIds) {
  try {
    localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify({ profile, ledBandIds }));
  } catch {}
}

export function ProfileProvider({ children }) {
  const [profile, setProfile] = useState(null);
  const [ledBandIds, setLedBandIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const loadedRef = useRef(false);

  async function loadProfile() {
    // getSession() reads the persisted session locally — unlike getUser(),
    // it doesn't require a network round-trip, so this still resolves when
    // the app is reopened somewhere with no signal.
    const { data: sessionData } = await supabase.auth.getSession();
    const uid = sessionData?.session?.user?.id;
    if (!uid) {
      setProfile(null);
      setLedBandIds([]);
      setLoading(false);
      loadedRef.current = false;
      try { localStorage.removeItem(PROFILE_CACHE_KEY); } catch {}
      return;
    }

    // Show the cached identity immediately (if any) so there's no hang —
    // refined below once/if the network fetch actually succeeds.
    const cached = readCachedProfile();
    if (cached) {
      setProfile(cached.profile);
      setLedBandIds(cached.ledBandIds || []);
      setLoading(false);
      loadedRef.current = true;
    }

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, role')
        .eq('id', uid)
        .single();
      if (error) throw error;

      setProfile(data || null);

      let leaderIds = [];
      if (data?.role === 'band_leader') {
        const { data: leaderRows } = await supabase
          .from('band_leaders')
          .select('band_id')
          .eq('profile_id', uid);
        leaderIds = (leaderRows || []).map((r) => r.band_id);
      }
      setLedBandIds(leaderIds);
      writeCachedProfile(data, leaderIds);
    } catch {
      // Offline or the request failed — fall back to whatever we already
      // set from cache above (or stay null if there was nothing cached).
    } finally {
      setLoading(false);
      loadedRef.current = true;
    }
  }

  useEffect(() => {
    loadProfile();

    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setProfile(null);
        setLedBandIds([]);
        setLoading(false);
        loadedRef.current = false;
      } else if (event === 'SIGNED_IN' && !loadedRef.current) {
        // Only reload if we don't already have a profile —
        // prevents tab-focus token refreshes from wiping navigation state
        setLoading(true);
        loadProfile();
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  return (
    <ProfileContext.Provider
      value={{
        profile,
        isAdmin: profile?.role === 'admin',
        isBandLeader: profile?.role === 'band_leader',
        ledBandIds,
        loading,
      }}
    >
      {children}
    </ProfileContext.Provider>
  );
}

export function useCurrentProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error('useCurrentProfile must be used inside ProfileProvider');
  return ctx;
}
import { createContext, useContext, useEffect, useState, useRef } from 'react';
import { supabase } from '../supabaseClient';

const ProfileContext = createContext(null);

export function ProfileProvider({ children }) {
  const [profile, setProfile] = useState(null);
  const [ledBandIds, setLedBandIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const loadedRef = useRef(false);

  async function loadProfile() {
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData?.user?.id;
    if (!uid) {
      setProfile(null);
      setLedBandIds([]);
      setLoading(false);
      loadedRef.current = false;
      return;
    }
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, role')
      .eq('id', uid)
      .single();
    setProfile(data || null);

    if (data?.role === 'band_leader') {
      const { data: leaderRows } = await supabase
        .from('band_leaders')
        .select('band_id')
        .eq('profile_id', uid);
      setLedBandIds((leaderRows || []).map((r) => r.band_id));
    } else {
      setLedBandIds([]);
    }

    setLoading(false);
    loadedRef.current = true;
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
import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

const ProfileContext = createContext(null);

export function ProfileProvider({ children }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function loadProfile() {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData?.user?.id;
      if (!uid) {
        if (active) { setProfile(null); setLoading(false); }
        return;
      }
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, role')
        .eq('id', uid)
        .single();
      if (active) {
        setProfile(data || null);
        setLoading(false);
      }
    }

    loadProfile();

    // Re-load profile whenever auth state changes (sign in / sign out)
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        if (active) { setProfile(null); setLoading(false); }
      } else if (event === 'SIGNED_IN') {
        setLoading(true);
        loadProfile();
      }
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  return (
    <ProfileContext.Provider value={{
      profile,
      isAdmin: profile?.role === 'admin',
      loading,
    }}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useCurrentProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error('useCurrentProfile must be used inside ProfileProvider');
  return ctx;
}
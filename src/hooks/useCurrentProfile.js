import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

export function useCurrentProfile() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData?.user?.id;
      if (!uid) {
        setLoading(false);
        return;
      }
      const { data } = await supabase.from('profiles').select('id, full_name, role').eq('id', uid).single();
      if (active) {
        setProfile(data);
        setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, []);

  return { profile, isAdmin: profile?.role === 'admin', loading };
}
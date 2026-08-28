import { createContext, useContext, useEffect, useState, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { getDeviceInfo } from '../utils/deviceInfo.js';

// Applies the user's app-wide UI colour theme (My Profile) via a
// data-theme attribute on <html> -- separate from --doc-accent/
// --doc-secondary, which is per-band document branding and lives
// entirely in inline styles on the invoice/quote/contract preview
// elements, never touching this attribute.
function applyUiTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme || 'default');
}

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

// Lets the admin-only Activity dashboard show device/PWA/notification info
// per user without logging every render or tab focus -- once confirmed
// signed in over the network, at most once per half hour per browser.
const SESSION_LOG_THROTTLE_MS = 30 * 60 * 1000;
const SESSION_LOG_KEY = 'gig_manager_last_session_log_at';

function maybeLogSession() {
  let last = 0;
  try {
    last = Number(localStorage.getItem(SESSION_LOG_KEY) || 0);
  } catch {}
  if (Date.now() - last < SESSION_LOG_THROTTLE_MS) return;

  // Stamp the throttle only once the call actually succeeds -- stamping it
  // up front meant a single failed invoke (cold start, transient network
  // blip) silently blocked any retry for the full 30 minutes, with that
  // device never appearing in the admin Activity dashboard and no error
  // surfaced anywhere.
  supabase.functions.invoke('log-session', { body: getDeviceInfo() })
    .then(({ error }) => {
      if (error) return;
      try { localStorage.setItem(SESSION_LOG_KEY, String(Date.now())); } catch {}
    })
    .catch(() => {});
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
      applyUiTheme('default');
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
      applyUiTheme(cached.profile?.ui_theme);
    }

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, role, ui_theme, avatar_url, subscription_tier, usage_logging_opt_out')
        .eq('id', uid)
        .single();
      if (error) throw error;

      setProfile(data || null);
      applyUiTheme(data?.ui_theme);
      // Admin's own usage is deliberately never collected here. Everyone
      // else can opt out in My Profile -- see "Your data" -- which is what
      // makes this first-party, troubleshooting-only logging exempt from
      // needing a cookie-consent banner under PECR Schedule A1.
      if (data && data.role !== 'admin' && !data.usage_logging_opt_out) maybeLogSession();

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
        applyUiTheme('default');
        // A stale unread-count badge left on the home-screen icon after
        // signing out (shared device, switching accounts) would be
        // confusing/wrong for whoever's using it next.
        if ('clearAppBadge' in navigator) {
          navigator.clearAppBadge().catch(() => {});
        }
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
        // Admins always have full access -- same reasoning as is_admin()
        // bypassing everything else in RLS -- everyone else needs an
        // active £1/month subscription. One flag, checked everywhere a
        // Pro-gated feature needs to decide whether to allow or upsell.
        isPro: profile?.role === 'admin' || profile?.subscription_tier === 'pro',
        ledBandIds,
        loading,
        // Re-fetches and re-caches the profile -- for callers that just wrote
        // to their own `profiles` row (name, theme, avatar) and need every
        // other consumer of this context (the header icon, notably) to pick
        // up the change immediately rather than on next reload.
        refreshProfile: loadProfile,
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
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

// Set the moment someone explicitly clicks "Turn off" below, cleared the
// moment they explicitly (re-)subscribe. Notification.permission alone
// can't tell "browser silently dropped the subscription" apart from
// "chose to turn it off in-app" -- both leave getSubscription() null with
// permission still 'granted' -- and only the first of those should ever
// get proactively re-created or flagged to the person as broken. Per-
// device on purpose, same lifetime as the subscription itself: wiped by
// the same uninstall that wipes the subscription, so a reinstall starts
// clean rather than remembering a stale opt-out from a previous install.
const OPTED_OUT_KEY = 'seeau_push_opted_out';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return new Uint8Array([...rawData].map((c) => c.charCodeAt(0)));
}

export function usePushNotifications() {
  const [permission, setPermission] = useState(
    'Notification' in window ? Notification.permission : 'unsupported'
  );
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const subscribe = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Get the real authenticated user ID directly from Supabase auth
      // rather than relying on a prop — eliminates any timing/null issue
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) throw new Error('Not signed in');

      if (!VAPID_PUBLIC_KEY) {
        throw new Error(
          'VITE_VAPID_PUBLIC_KEY is not set. Add it to Cloudflare environment variables and redeploy.'
        );
      }

      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') {
        setLoading(false);
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });

      const subJson = subscription.toJSON();
      const endpoint = subJson.endpoint;
      const p256dh = subJson.keys?.p256dh;
      const auth = subJson.keys?.auth;

      if (!endpoint || !p256dh || !auth) {
        throw new Error('Browser returned an incomplete push subscription — try again.');
      }

      // Log what we're about to insert so you can see it in the browser console
      console.log('Inserting push subscription for user:', user.id);
      console.log('Endpoint:', endpoint.slice(0, 60) + '...');

      const { error: dbError } = await supabase
        .from('push_subscriptions')
        .upsert(
          {
            profile_id: user.id,
            endpoint,
            p256dh,
            auth_key: auth,
            user_agent: navigator.userAgent.slice(0, 200),
          },
          { onConflict: 'endpoint' }
        );

      if (dbError) {
        console.error('Supabase error:', dbError);
        throw new Error(dbError.message);
      }

      setSubscribed(true);
      // Successfully (re-)subscribed -- whatever "turned off" state this
      // device was in before no longer applies.
      try { localStorage.removeItem(OPTED_OUT_KEY); } catch {}
    } catch (err) {
      console.error('Push subscription error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const unsubscribe = useCallback(async () => {
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.getSubscription();
      if (subscription) {
        await supabase
          .from('push_subscriptions')
          .delete()
          .eq('endpoint', subscription.endpoint);
        await subscription.unsubscribe();
      }
      setSubscribed(false);
      // Records this as a deliberate choice -- see OPTED_OUT_KEY above --
      // so nothing later mistakes the resulting "granted permission, no
      // subscription" state for a silently broken one and either
      // recreates it unasked or nags the person to fix something they
      // chose themselves.
      try { localStorage.setItem(OPTED_OUT_KEY, 'true'); } catch {}
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Checks AND self-heals, not just checks -- re-affirming an existing
  // subscription with the push service is idempotent (same
  // applicationServerKey, no new permission prompt, no user-visible
  // effect on a healthy subscription) but is also what catches a quietly
  // stale/rotated endpoint before it ever shows up as "failing" server-
  // side. Deliberately only refreshes an EXISTING subscription (`existing`
  // truthy) -- never calls subscribe() from a null one, since that same
  // null state is also exactly what "explicitly turned off" below looks
  // like, and auto-recreating it from nothing would silently reverse that
  // choice on the person's next visit.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready.then(async (reg) => {
      const existing = await reg.pushManager.getSubscription();
      setSubscribed(!!existing);
      if (existing) subscribe();
    });
  }, [subscribe]);

  return { permission, subscribed, loading, error, subscribe, unsubscribe };
}
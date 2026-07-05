import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

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

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready.then(async (reg) => {
      const existing = await reg.pushManager.getSubscription();
      setSubscribed(!!existing);
    });
  }, []);

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
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  return { permission, subscribed, loading, error, subscribe, unsubscribe };
}
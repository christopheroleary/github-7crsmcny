import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return new Uint8Array([...rawData].map((c) => c.charCodeAt(0)));
}

export function usePushNotifications(profileId) {
  const [permission, setPermission] = useState(
    'Notification' in window ? Notification.permission : 'unsupported'
  );
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Check if already subscribed
  useEffect(() => {
    if (!profileId || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready.then(async (reg) => {
      const existing = await reg.pushManager.getSubscription();
      setSubscribed(!!existing);
    });
  }, [profileId]);

  const subscribe = useCallback(async () => {
    if (!VAPID_PUBLIC_KEY) {
      setError('Push notifications not configured — VAPID public key missing.');
      return;
    }
    setLoading(true);
    setError(null);

    try {
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

      const { endpoint, keys } = subscription.toJSON();

      const { error: dbError } = await supabase
        .from('push_subscriptions')
        .upsert({
          profile_id: profileId,
          endpoint,
          p256dh: keys.p256dh,
          auth_key: keys.auth,
          user_agent: navigator.userAgent.slice(0, 200),
        }, { onConflict: 'endpoint' });

      if (dbError) throw new Error(dbError.message);
      setSubscribed(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [profileId]);

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
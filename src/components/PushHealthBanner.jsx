import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { usePushNotifications } from '../hooks/usePushNotifications.js';

// Same threshold as the admin-only "Push notification health" panel
// (UserActivity.jsx's FAILING_THRESHOLD) -- kept as a separate constant
// rather than a shared import since it's one small number and the two
// components read it in genuinely different shapes (that one aggregates
// every device across every person; this one only ever looks at the one
// device it's running on).
const FAILING_THRESHOLD = 2;

const OPTED_OUT_KEY = 'seeau_push_opted_out';

// Mounted once, globally, in the signed-in app shell (App.jsx) -- the
// admin's Push notification health panel already knows the moment
// someone's notifications quietly stop working, but that information
// never reached the person it's actually about; they'd only find out if
// an admin happened to check the dashboard and think to text them. This
// is the same signal, read from the other side: a quiet, self-serve check
// the affected person sees for themselves, without needing an admin in
// the loop at all.
export default function PushHealthBanner() {
  const { subscribe, loading } = usePushNotifications();
  // checking | ok | missing | failing -- 'dismissed' collapses back to ok
  // for rendering purposes but is kept distinct so a re-check (e.g. after
  // tapping Re-enable) can still land back on missing/failing correctly.
  const [status, setStatus] = useState('checking');
  const [dismissed, setDismissed] = useState(false);

  const check = useCallback(async () => {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      setStatus('ok');
      return;
    }
    // Nothing to check yet -- 'default' (never asked) and 'denied' both
    // already have their own, more direct in-app messaging elsewhere
    // (NotificationSetup's own blocked state); this banner is only about
    // "you turned this on and it stopped working", not "you never turned
    // it on".
    if (Notification.permission !== 'granted') {
      setStatus('ok');
      return;
    }

    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();

    if (!sub) {
      // Permission is granted but there's no live subscription on this
      // device -- either the browser silently dropped it (worth flagging)
      // or this is exactly the state right after an explicit "Turn off"
      // in Settings (NOT worth flagging: nagging someone to re-enable
      // something they just chose to turn off would be actively wrong).
      // OPTED_OUT_KEY is what tells these two apart -- see
      // usePushNotifications.js for where it's set/cleared.
      let optedOut = false;
      try { optedOut = localStorage.getItem(OPTED_OUT_KEY) === 'true'; } catch {}
      setStatus(optedOut ? 'ok' : 'missing');
      return;
    }

    const { data } = await supabase
      .from('push_subscriptions')
      .select('consecutive_failures')
      .eq('endpoint', sub.endpoint)
      .maybeSingle();
    setStatus(data && data.consecutive_failures >= FAILING_THRESHOLD ? 'failing' : 'ok');
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  if (dismissed || status === 'checking' || status === 'ok') return null;

  return (
    <div className="notification-bar notification-bar--blocked" style={{ margin: '0 0 16px' }}>
      <div>
        <strong>🔕 Notifications on this device seem to have stopped</strong>
        <p style={{ margin: '2px 0 0' }}>
          {status === 'missing'
            ? "This device isn't receiving push notifications anymore."
            : "The last few notifications to this device didn't get through."}
          {' '}Tap to re-enable, or dismiss if you'd rather sort it out later.
        </p>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          className="btn btn--primary btn--small"
          disabled={loading}
          onClick={async () => {
            await subscribe();
            check();
          }}
        >
          {loading ? 'Re-enabling…' : 'Re-enable'}
        </button>
        <button type="button" className="link-button" onClick={() => setDismissed(true)}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

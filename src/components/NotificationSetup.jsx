import { useState } from 'react';
import { usePushNotifications } from '../hooks/usePushNotifications.js';

export default function NotificationSetup() {
  const { permission, subscribed, loading, error, subscribe, unsubscribe } =
    usePushNotifications();
  // A soft, in-app ask shown before ever firing the REAL browser permission
  // dialog -- that one can only ever be shown once per browser: hitting
  // Deny there is permanent (the browser won't display it again without
  // the person digging into their own settings), while "Not now" here
  // costs nothing and can be asked again another day. Component-local
  // state on purpose, not persisted -- resets on next visit rather than
  // becoming a second permanent "no".
  const [primingDismissed, setPrimingDismissed] = useState(false);

  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    return (
      <div className="notification-bar notification-bar--blocked">
        <span>🔕 Push notifications aren't supported in this browser.</span>
      </div>
    );
  }

  if (permission === 'denied') {
    return (
      <div className="notification-bar notification-bar--blocked">
        <span>🔕 Notifications are blocked. Open browser settings to re-enable them.</span>
      </div>
    );
  }

  if (subscribed) {
    return (
      <div className="notification-bar notification-bar--on">
        <span>🔔 Push notifications on</span>
        <button className="link-button" onClick={unsubscribe} disabled={loading}>
          {loading ? 'Turning off…' : 'Turn off'}
        </button>
      </div>
    );
  }

  // The soft ask -- only relevant while permission is still 'default'
  // (unasked). Skipped once granted/denied/subscribed, which have their
  // own branches above, and skipped after the person has already seen it
  // once this visit (either answer dismisses it -- "Yes" moves straight
  // into the real dialog below, no need to ask twice).
  if (permission !== 'granted' && !primingDismissed) {
    return (
      <div className="notification-bar notification-bar--off">
        <div>
          <strong>Get gig reminders?</strong>
          <p>Departure reminders and gig updates, even when the app is closed.</p>
        </div>
        {error && <p className="form-error" style={{ margin: '6px 0 0' }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn--primary btn--small" onClick={subscribe} disabled={loading}>
            {loading ? 'Setting up…' : 'Yes, enable'}
          </button>
          <button className="btn btn--ghost btn--small" onClick={() => setPrimingDismissed(true)}>
            Not now
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="notification-bar notification-bar--off">
      <div>
        <strong>Enable notifications</strong>
        <p>Get departure reminders and gig updates even when the app is closed.</p>
      </div>
      {error && <p className="form-error" style={{ margin: '6px 0 0' }}>{error}</p>}
      <button className="btn btn--primary btn--small" onClick={subscribe} disabled={loading}>
        {loading ? 'Setting up…' : '🔔 Enable notifications'}
      </button>
    </div>
  );
}
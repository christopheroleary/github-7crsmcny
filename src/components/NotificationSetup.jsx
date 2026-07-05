import { usePushNotifications } from '../hooks/usePushNotifications.js';

export default function NotificationSetup() {
  const { permission, subscribed, loading, error, subscribe, unsubscribe } =
    usePushNotifications();

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
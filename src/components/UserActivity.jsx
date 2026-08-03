import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';

function formatRelative(iso) {
  if (!iso) return 'Never';
  const d = new Date(iso);
  const diffMins = Math.floor((Date.now() - d) / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return diffMins + 'm ago';
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return diffHours + 'h ago';
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return diffDays + 'd ago';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// push_subscribed (an active push_subscriptions row) is the strongest
// signal -- Notification.permission alone can be "granted" from an old
// visit even after they turned notifications back off in-app.
function notificationLabel(row) {
  if (row.push_subscribed) return '🔔 On';
  if (row.notification_permission === 'denied') return 'Blocked';
  if (row.notification_permission === 'granted') return 'Granted, not subscribed';
  if (row.notification_permission === 'unsupported') return 'Unsupported';
  if (row.notification_permission === 'default') return 'Not asked';
  return '—';
}

export default function UserActivity() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    // One row per distinct device/browser/PWA combo a person has used, not
    // just their single most-recent one -- someone with notifications on
    // for their phone PWA but off in a desktop browser tab needs both to
    // show, not just whichever they happened to open most recently.
    const { data, error } = await supabase
      .from('user_device_sessions')
      .select('*')
      .order('full_name', { ascending: true })
      .order('last_seen_at', { ascending: false, nullsFirst: false });
    if (error) setError(error.message);
    else setRows(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div className="section-header">
        <h2 className="section-header__title">Activity</h2>
        <button className="link-button" onClick={load}>↻ Refresh</button>
      </div>
      <p className="field__hint" style={{ marginBottom: 12 }}>
        Who's using the app, what device they're on, and whether they've installed it as a PWA or enabled push notifications.
        Someone using both a phone and a desktop browser (or a PWA install alongside a regular browser tab on the same
        device) gets one row per distinct device/browser. Updates the first time someone opens the app after being idle
        for 30+ minutes. Admin accounts are never tracked or shown here.
      </p>

      {loading ? (
        <p className="state-message">Loading activity…</p>
      ) : error ? (
        <p className="state-message state-message--error">Couldn't load activity: {error}</p>
      ) : rows.length === 0 ? (
        <p className="state-message">No one to show.</p>
      ) : (
        <div className="activity-table">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Last seen</th>
                <th>Device</th>
                <th>OS</th>
                <th>Browser</th>
                <th>Screen</th>
                <th>PWA installed</th>
                <th>Notifications</th>
                <th>IP address</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.profile_id + '|' + (r.user_agent || '') + '|' + r.is_pwa}>
                  <td>{r.full_name || '—'}</td>
                  <td>{r.role}</td>
                  <td>{formatRelative(r.last_seen_at)}</td>
                  <td>{r.device_type || '—'}</td>
                  <td>{r.os || '—'}</td>
                  <td>{r.browser || '—'}</td>
                  <td>{r.screen_width && r.screen_height ? r.screen_width + '×' + r.screen_height : '—'}</td>
                  <td>{r.last_seen_at ? (r.is_pwa ? 'Yes' : 'No') : '—'}</td>
                  <td>{r.last_seen_at ? notificationLabel(r) : '—'}</td>
                  <td>{r.ip_address || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

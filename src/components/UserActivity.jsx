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

// A subscription is only pruned outright on a hard 410/403 (see
// notify-musician/index.ts etc.) -- anything else (timeout, a 5xx from
// Apple/Google's push service) just increments consecutive_failures
// instead, which is what this threshold reads. 2+ in a row, on every one
// of a person's devices, is "this genuinely isn't getting through" rather
// than a single blip -- one bad send is normal network noise.
const FAILING_THRESHOLD = 2;

function personPushStatus(devices) {
  const attempted = devices.filter((d) => d.last_success_at || d.last_failure_at);
  if (attempted.length === 0) return { key: 'unknown', label: 'No delivery attempts yet' };
  const allFailing = devices.every((d) => d.consecutive_failures >= FAILING_THRESHOLD);
  if (allFailing) return { key: 'failing', label: '⚠️ Failing on every device' };
  const anyFailing = devices.some((d) => d.consecutive_failures >= FAILING_THRESHOLD);
  if (anyFailing) return { key: 'partial', label: '⚠️ Failing on one device' };
  return { key: 'healthy', label: '🔔 Healthy' };
}

function mostRecent(devices, field) {
  const dates = devices.map((d) => d[field]).filter(Boolean);
  if (dates.length === 0) return null;
  return dates.reduce((latest, d) => (d > latest ? d : latest));
}

// One row per person, not per device -- "group by person" was the explicit
// ask, since what matters for deciding whether to text someone is their
// overall reachability, not which specific phone/browser it's on. Devices
// still factor in: a person only reads as Healthy if not EVERY device is
// failing, and the device count itself is shown so "1 device, failing"
// reads differently from "3 devices, 1 failing".
function groupByPerson(rows) {
  const byPerson = new Map();
  for (const row of rows) {
    if (!byPerson.has(row.profile_id)) {
      byPerson.set(row.profile_id, { profile_id: row.profile_id, full_name: row.full_name, role: row.role, devices: [] });
    }
    byPerson.get(row.profile_id).devices.push(row);
  }
  return Array.from(byPerson.values())
    .map((person) => ({
      ...person,
      status: personPushStatus(person.devices),
      lastSuccessAt: mostRecent(person.devices, 'last_success_at'),
      lastFailureReason: person.devices.find((d) => d.consecutive_failures >= FAILING_THRESHOLD)?.last_failure_reason || null,
    }))
    // Whoever needs action surfaces first: failing (worst first), then
    // partial, then healthy/unknown -- alphabetical within each group.
    .sort((a, b) => {
      const order = { failing: 0, partial: 1, healthy: 2, unknown: 3 };
      if (order[a.status.key] !== order[b.status.key]) return order[a.status.key] - order[b.status.key];
      return (a.full_name || '').localeCompare(b.full_name || '');
    });
}

function PushHealthSection() {
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.from('push_subscription_health').select('*');
    if (error) setError(error.message);
    else setPeople(groupByPerson(data || []));
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="roster-section" style={{ marginBottom: 24 }}>
      <div className="section-header">
        <h3 className="roster-section__title" style={{ marginBottom: 0 }}>Push notification health</h3>
        <button className="link-button" onClick={load}>↻ Refresh</button>
      </div>
      <p className="field__hint" style={{ marginBottom: 12 }}>
        Only people with push notifications turned on appear here. "Failing" means the last {FAILING_THRESHOLD}+ attempts to
        every one of their devices came back as an error that isn't an outright dead subscription (those get removed
        automatically) -- worth a text or an in-person nudge to reopen the app and re-enable notifications.
      </p>

      {loading ? (
        <p className="state-message">Loading…</p>
      ) : error ? (
        <p className="state-message state-message--error">Couldn't load push health: {error}</p>
      ) : people.length === 0 ? (
        <p className="state-message">Nobody has push notifications turned on yet.</p>
      ) : (
        <div className="activity-table">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Devices</th>
                <th>Last delivered</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.profile_id}>
                  <td>{p.full_name || '—'}</td>
                  <td>{p.role}</td>
                  <td>{p.devices.length}</td>
                  <td>{formatRelative(p.lastSuccessAt)}</td>
                  <td title={p.lastFailureReason || undefined}>{p.status.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
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
      </div>

      <PushHealthSection />

      <div className="section-header">
        <h3 className="roster-section__title" style={{ marginBottom: 0 }}>Devices</h3>
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

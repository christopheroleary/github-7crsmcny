import { useEffect, useState, useRef, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useCurrentProfile } from '../context/ProfileContext.jsx';

export default function NotificationBell({ onNavigate }) {
  const { profile } = useCurrentProfile();
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const panelRef = useRef(null);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const load = useCallback(async () => {
    if (!profile?.id) return;
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('profile_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(30);
    setNotifications(data || []);
    setLoading(false);
  }, [profile?.id]);

  useEffect(() => {
    load();
  }, [load]);

  // Real-time: INSERT and UPDATE both handled
  useEffect(() => {
    if (!profile?.id) return;

    const channel = supabase
      .channel('notifications:' + profile.id)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: 'profile_id=eq.' + profile.id,
        },
        (payload) => {
          setNotifications((prev) => [payload.new, ...prev]);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: 'profile_id=eq.' + profile.id,
        },
        (payload) => {
          setNotifications((prev) =>
            prev.map((n) => (n.id === payload.new.id ? { ...n, ...payload.new } : n))
          );
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'notifications',
          filter: 'profile_id=eq.' + profile.id,
        },
        (payload) => {
          setNotifications((prev) => prev.filter((n) => n.id !== payload.old.id));
        }
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [profile?.id]);

  // Close panel when clicking outside
  useEffect(() => {
    function handleClick(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  async function markRead(notification) {
    if (!notification.read) {
      await supabase
        .from('notifications')
        .update({ read: true })
        .eq('id', notification.id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === notification.id ? { ...n, read: true } : n))
      );
    }
    setOpen(false);
    if (onNavigate) {
      onNavigate({ url: notification.url, gig_id: notification.gig_id || null });
    }
  }

  async function markAllRead() {
    const unreadIds = notifications.filter((n) => !n.read).map((n) => n.id);
    if (unreadIds.length === 0) return;
    await supabase
      .from('notifications')
      .update({ read: true })
      .in('id', unreadIds);
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }

  async function clearAll() {
    await supabase
      .from('notifications')
      .delete()
      .eq('profile_id', profile.id);
    setNotifications([]);
  }

  function formatTime(iso) {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return diffMins + 'm ago';
    if (diffHours < 24) return diffHours + 'h ago';
    if (diffDays < 7) return diffDays + 'd ago';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  return (
    <div className="notif-bell" ref={panelRef}>
      <button
        className={'notif-bell__btn' + (open ? ' notif-bell__btn--active' : '')}
        onClick={() => setOpen((v) => !v)}
        aria-label={'Notifications' + (unreadCount > 0 ? ', ' + unreadCount + ' unread' : '')}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        {unreadCount > 0 && (
          <span className="notif-bell__badge">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="notif-panel">
          <div className="notif-panel__header">
            <span className="notif-panel__title">Notifications</span>
            <div style={{ display: 'flex', gap: 10 }}>
              {unreadCount > 0 && (
                <button className="link-button" style={{ fontSize: 12 }} onClick={markAllRead}>
                  Mark all read
                </button>
              )}
              {notifications.length > 0 && (
                <button className="link-button link-button--danger" style={{ fontSize: 12 }} onClick={clearAll}>
                  Clear all
                </button>
              )}
            </div>
          </div>

          {loading ? (
            <p className="notif-panel__empty">Loading…</p>
          ) : notifications.length === 0 ? (
            <p className="notif-panel__empty">No notifications yet.</p>
          ) : (
            <ul className="notif-panel__list">
              {notifications.map((n) => (
                <li
                  key={n.id}
                  className={'notif-item' + (n.read ? ' notif-item--read' : '')}
                  onClick={() => markRead(n)}
                >
                  <div className="notif-item__dot-col">
                    {!n.read && <span className="notif-item__dot" />}
                  </div>
                  <div className="notif-item__body">
                    <p className="notif-item__title">{n.title}</p>
                    <p className="notif-item__text">{n.body}</p>
                    <p className="notif-item__time">{formatTime(n.created_at)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
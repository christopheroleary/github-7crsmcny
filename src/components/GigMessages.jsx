import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useCurrentProfile } from '../context/ProfileContext.jsx';
import { confirmAsync } from '../utils/confirmService.js';
import { notify } from '../utils/toastService.js';

const MAX_LENGTH = 160;

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

// Group chat scoped to a single gig -- visible/postable only to that gig's
// own roster, the band's leader, and admins (enforced server-side by RLS;
// `lineup` here is only used to decide whether to render this section at
// all for the current viewer, same pattern as the isAdmin-gated sections
// elsewhere on this page). Messages are immutable once sent -- there's no
// edit, only delete-your-own-or-admin -- and capped at 160 characters,
// same as a classic SMS.
export default function GigMessages({ gigId, bandId, lineup = [] }) {
  const { profile, isAdmin, isBandLeader, ledBandIds } = useCurrentProfile();
  const [messages, setMessages] = useState([]);
  const [namesById, setNamesById] = useState({});
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);

  const canAccess = Boolean(profile) && (
    isAdmin
    || (isBandLeader && bandId && ledBandIds.includes(bandId))
    || lineup.some((l) => l.profile_id === profile.id)
  );

  const load = useCallback(async () => {
    if (!canAccess) { setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase
      .from('gig_messages')
      .select('id, sender_id, body, created_at, sender:profiles(full_name)')
      .eq('gig_id', gigId)
      .order('created_at', { ascending: true })
      .limit(200);
    setMessages(data || []);
    setNamesById((prev) => {
      const next = { ...prev };
      (data || []).forEach((m) => { next[m.sender_id] = m.sender?.full_name || 'Unknown'; });
      return next;
    });
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gigId, canAccess]);

  useEffect(() => { load(); }, [load]);

  // Realtime -- new messages (from anyone with access) and deletions both
  // show up live without needing a refresh. A brand-new sender we haven't
  // seen this session yet (no embed on postgres_changes payloads) gets a
  // one-off name lookup so their bubble isn't stuck showing "Unknown".
  useEffect(() => {
    if (!canAccess) return;

    const channel = supabase
      .channel('gig-messages:' + gigId)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'gig_messages', filter: 'gig_id=eq.' + gigId },
        (payload) => {
          setMessages((prev) => (prev.some((m) => m.id === payload.new.id) ? prev : [...prev, payload.new]));
          setNamesById((prev) => {
            if (prev[payload.new.sender_id]) return prev;
            supabase.from('profiles').select('full_name').eq('id', payload.new.sender_id).single()
              .then(({ data }) => {
                if (data) setNamesById((p) => ({ ...p, [payload.new.sender_id]: data.full_name }));
              });
            return prev;
          });
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'gig_messages', filter: 'gig_id=eq.' + gigId },
        (payload) => {
          setMessages((prev) => prev.filter((m) => m.id !== payload.old.id));
        }
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [gigId, canAccess]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages.length]);

  async function handleSend(e) {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || trimmed.length > MAX_LENGTH || sending) return;
    setSending(true);
    const { data, error } = await supabase
      .from('gig_messages')
      .insert({ gig_id: gigId, sender_id: profile.id, body: trimmed })
      .select('id, sender_id, body, created_at')
      .single();
    setSending(false);
    if (error) {
      notify("Couldn't send: " + error.message);
      return;
    }
    setBody('');
    setNamesById((prev) => ({ ...prev, [profile.id]: profile.full_name }));
    setMessages((prev) => (prev.some((m) => m.id === data.id) ? prev : [...prev, data]));
  }

  async function handleDelete(id) {
    const ok = await confirmAsync('Delete this message? This can\'t be undone.');
    if (!ok) return;
    const { error } = await supabase.from('gig_messages').delete().eq('id', id);
    if (error) { notify("Couldn't delete: " + error.message); return; }
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }

  if (!canAccess) return null;

  const remaining = MAX_LENGTH - body.length;

  return (
    <div className="day-sheet__section gig-chat">
      <h3 className="day-sheet__section-title">Gig chat</h3>
      <p className="field__hint" style={{ marginTop: -6, marginBottom: 10 }}>
        No notifications are sent for these — think of them more like notes left for whoever's next to check this gig, not a way to reach someone urgently.
      </p>

      <div className="gig-chat__messages" ref={listRef}>
        {loading && <p className="field__hint">Loading messages…</p>}
        {!loading && messages.length === 0 && (
          <p className="field__hint">No messages yet — say hi.</p>
        )}
        {messages.map((m, i) => {
          const mine = m.sender_id === profile.id;
          const prevSender = i > 0 ? messages[i - 1].sender_id : null;
          const showName = !mine && m.sender_id !== prevSender;
          const canDelete = mine || isAdmin;
          return (
            <div key={m.id} className={'gig-chat__row' + (mine ? ' gig-chat__row--mine' : '')}>
              {showName && <span className="gig-chat__sender">{namesById[m.sender_id] || 'Unknown'}</span>}
              <div className="gig-chat__bubble-wrap">
                <div className="gig-chat__bubble">{m.body}</div>
                <span className="gig-chat__time">
                  {formatTime(m.created_at)}
                  {canDelete && (
                    <button
                      type="button"
                      className="gig-chat__delete"
                      onClick={() => handleDelete(m.id)}
                      aria-label="Delete message"
                      title="Delete"
                    >
                      ×
                    </button>
                  )}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <form className="gig-chat__compose" onSubmit={handleSend}>
        <input
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, MAX_LENGTH))}
          placeholder="Message the gig…"
          maxLength={MAX_LENGTH}
          disabled={sending}
        />
        <span className={'gig-chat__counter' + (remaining <= 20 ? ' gig-chat__counter--low' : '')}>
          {remaining}
        </span>
        <button type="submit" className="btn btn--primary btn--small" disabled={!body.trim() || sending}>
          {sending ? '…' : 'Send'}
        </button>
      </form>
    </div>
  );
}

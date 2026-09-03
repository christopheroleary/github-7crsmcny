import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useCurrentProfile } from '../context/ProfileContext.jsx';
import InfoTooltip from './InfoTooltip.jsx';
import { confirmAsync } from '../utils/confirmService.js';
import { notify } from '../utils/toastService.js';

const MAX_LENGTH = 160;

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

// rows: [{ message_id, profile_id }] -> { [message_id]: { count, mine } }
function buildReactionMap(rows, myProfileId) {
  const map = {};
  rows.forEach((r) => {
    const entry = map[r.message_id] || { count: 0, mine: false };
    entry.count += 1;
    if (r.profile_id === myProfileId) entry.mine = true;
    map[r.message_id] = entry;
  });
  return map;
}

// Grows the compose box up to MAX_COMPOSE_HEIGHT as the message wraps to
// more lines (the actual iMessage/WhatsApp behaviour the plain single-line
// <input> this replaced couldn't do at all -- text just scrolled sideways
// inside it, and Enter had no way to mean anything but "send"), then
// scrolls internally past that rather than growing forever.
const MAX_COMPOSE_HEIGHT = 110;
function autoResizeCompose(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, MAX_COMPOSE_HEIGHT) + 'px';
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
  const [reactionsByMessage, setReactionsByMessage] = useState({}); // message_id -> { count, mine }
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);
  const composeRef = useRef(null);

  useEffect(() => { autoResizeCompose(composeRef.current); }, [body]);

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

    const ids = (data || []).map((m) => m.id);
    if (ids.length > 0) {
      const { data: reactions } = await supabase
        .from('gig_message_reactions')
        .select('message_id, profile_id')
        .in('message_id', ids);
      setReactionsByMessage(buildReactionMap(reactions || [], profile?.id));
    } else {
      setReactionsByMessage({});
    }

    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gigId, canAccess, profile?.id]);

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
      // gig_message_reactions carries no gig_id column (see the migration --
      // RLS derives access from the message it points at instead), so this
      // can't be filtered server-side the way the two subscriptions above
      // are. Subscribing unfiltered and checking client-side against the
      // currently-loaded messages is the tradeoff -- harmless, since RLS
      // still means a reaction on a gig this viewer can't see never reaches
      // the client in the first place.
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'gig_message_reactions' },
        (payload) => {
          setMessages((current) => {
            if (!current.some((m) => m.id === payload.new.message_id)) return current;
            setReactionsByMessage((prev) => {
              const entry = prev[payload.new.message_id] || { count: 0, mine: false };
              return {
                ...prev,
                [payload.new.message_id]: {
                  count: entry.count + 1,
                  mine: entry.mine || payload.new.profile_id === profile?.id,
                },
              };
            });
            return current;
          });
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'gig_message_reactions' },
        (payload) => {
          setMessages((current) => {
            if (!current.some((m) => m.id === payload.old.message_id)) return current;
            setReactionsByMessage((prev) => {
              const entry = prev[payload.old.message_id];
              if (!entry) return prev;
              return {
                ...prev,
                [payload.old.message_id]: {
                  count: Math.max(0, entry.count - 1),
                  mine: payload.old.profile_id === profile?.id ? false : entry.mine,
                },
              };
            });
            return current;
          });
        }
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Optimistic toggle, reverted on error -- same pattern as MyRepertoire's
  // checkbox ticks. No notification either way (unlike a new message) --
  // a like is meant to be a light touch, not another push alert.
  async function handleToggleLike(messageId) {
    const already = reactionsByMessage[messageId]?.mine;
    setReactionsByMessage((prev) => {
      const entry = prev[messageId] || { count: 0, mine: false };
      return { ...prev, [messageId]: { count: entry.count + (already ? -1 : 1), mine: !already } };
    });

    const { error } = already
      ? await supabase.from('gig_message_reactions').delete().eq('message_id', messageId).eq('profile_id', profile.id)
      : await supabase.from('gig_message_reactions').insert({ message_id: messageId, profile_id: profile.id });

    if (error) {
      setReactionsByMessage((prev) => {
        const entry = prev[messageId] || { count: 0, mine: false };
        return { ...prev, [messageId]: { count: entry.count + (already ? 1 : -1), mine: already } };
      });
      notify("Couldn't save: " + error.message);
    }
  }

  if (!canAccess) return null;

  const remaining = MAX_LENGTH - body.length;

  return (
    <div className="day-sheet__section gig-chat" id="gig-section-chat">
      <h3 className="roster-section__title">
        Gig chat
        <InfoTooltip text="Everyone else on this gig's roster gets a notification when you send one of these." />
      </h3>

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
          const reaction = reactionsByMessage[m.id];
          return (
            <div key={m.id} className={'gig-chat__row' + (mine ? ' gig-chat__row--mine' : '')}>
              {showName && <span className="gig-chat__sender">{namesById[m.sender_id] || 'Unknown'}</span>}
              <div className="gig-chat__bubble-wrap">
                <div className="gig-chat__bubble">{m.body}</div>
                <span className="gig-chat__time">
                  {formatTime(m.created_at)}
                  <button
                    type="button"
                    className={'gig-chat__like' + (reaction?.mine ? ' gig-chat__like--active' : '')}
                    onClick={() => handleToggleLike(m.id)}
                    aria-label={reaction?.mine ? 'Remove like' : 'Like this message'}
                    title={reaction?.mine ? 'Remove like' : 'Like'}
                  >
                    👍{reaction?.count > 0 ? ' ' + reaction.count : ''}
                  </button>
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
        <textarea
          ref={composeRef}
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, MAX_LENGTH))}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter (or any IME composition in progress)
            // inserts a real line break -- the one thing a single-line
            // <input> could never do, which was the actual complaint.
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              handleSend(e);
            }
          }}
          placeholder="Message the gig…"
          maxLength={MAX_LENGTH}
          disabled={sending}
          rows={1}
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

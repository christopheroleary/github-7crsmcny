import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { notify } from '../utils/toastService.js';
import { confirmAsync } from '../utils/confirmService.js';

const STATUS_COLORS = {
  new: 'inquiry',
  read: 'confirmed',
  archived: 'cancelled',
};

function formatDateTime(iso) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// Admin-only. `message` is rendered as plain JSX text below, never via
// dangerouslySetInnerHTML -- a submitted message can't execute as HTML/JS
// here no matter what it contains.
export default function FeedbackInbox() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('feedback')
      .select('*, profiles(full_name)')
      .order('created_at', { ascending: false });
    setItems(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function updateStatus(item, status) {
    const { error } = await supabase.from('feedback').update({ status }).eq('id', item.id);
    if (error) {
      notify("Couldn't update: " + error.message);
      return;
    }
    load();
  }

  async function handleDelete(item) {
    const ok = await confirmAsync('Delete this feedback? This cannot be undone.');
    if (!ok) return;
    const { error } = await supabase.from('feedback').delete().eq('id', item.id);
    if (error) {
      notify("Couldn't delete: " + error.message);
      return;
    }
    load();
  }

  if (loading) return <p className="state-message">Loading feedback…</p>;

  const visible = items.filter((i) => showArchived || i.status !== 'archived');
  const newCount = items.filter((i) => i.status === 'new').length;

  return (
    <div className="day-sheet__section">
      <h3 className="day-sheet__section-title">
        Feedback{newCount > 0 ? ` (${newCount} new)` : ''}
      </h3>
      <p className="field__hint" style={{ marginBottom: 12 }}>
        Sent directly by band leaders and musicians from anywhere in the app.
      </p>

      <button type="button" className="link-button" style={{ marginBottom: 12 }} onClick={() => setShowArchived((v) => !v)}>
        {showArchived ? 'Hide archived' : 'Show archived'}
      </button>

      {visible.length === 0 && <p className="field__hint">No feedback yet.</p>}

      {visible.length > 0 && (
        <ul className="simple-list">
          {visible.map((item) => (
            <li
              className="simple-list__item"
              key={item.id}
              onClick={() => item.status === 'new' && updateStatus(item, 'read')}
              style={{ cursor: item.status === 'new' ? 'pointer' : 'default' }}
            >
              <div className="simple-list__row">
                <div>
                  <span className="simple-list__title">
                    {item.profiles?.full_name || 'Unknown'}
                    <span className={'status-tag status-tag--' + STATUS_COLORS[item.status]} style={{ marginLeft: 8 }}>
                      {item.status}
                    </span>
                  </span>
                  <span className="simple-list__subtitle">
                    {formatDateTime(item.created_at)}{item.page ? ' · ' + item.page : ''}
                  </span>
                  <p style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{item.message}</p>
                </div>
                <div className="simple-list__actions" onClick={(e) => e.stopPropagation()}>
                  {item.status !== 'archived' && (
                    <button className="link-button" onClick={() => updateStatus(item, 'archived')}>Archive</button>
                  )}
                  {item.status === 'archived' && (
                    <button className="link-button" onClick={() => updateStatus(item, 'read')}>Unarchive</button>
                  )}
                  <button className="link-button link-button--danger" onClick={() => handleDelete(item)}>Delete</button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

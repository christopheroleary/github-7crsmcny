import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useCurrentProfile } from '../context/ProfileContext.jsx';
import { loadMyTasks } from '../utils/tasksData.js';
import { notify } from '../utils/toastService.js';

const KIND_ICON = {
  needs_invoicing: '💷',
  anniversary: '🎉',
  uninvited_dep: '✉',
};

// Dashboard's "My tasks" -- every task the viewer can see, company-wide for
// a real admin, own-bands-only for a leader (loadMyTasks relies on RLS for
// this, not a band id list, so it never needs to know which case it's in).
// `isAdmin` here is only used to decide which bands populate the "add a
// task" band picker below -- every band for a real admin, just the ones
// they lead for anyone else.
export default function TasksWidget({ isAdmin, ledBandIds, onNavigate }) {
  const { profile: me } = useCurrentProfile();
  const [bandOptions, setBandOptions] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [addBandId, setAddBandId] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const bandsQuery = isAdmin
      ? supabase.from('bands').select('id, name').order('name')
      : (ledBandIds && ledBandIds.length
          ? supabase.from('bands').select('id, name').in('id', ledBandIds).order('name')
          : null);
    const [{ data: bandRows } = { data: [] }, tasks] = await Promise.all([
      bandsQuery || Promise.resolve({ data: [] }),
      loadMyTasks(),
    ]);
    setBandOptions(bandRows || []);
    setAddBandId((prev) => prev || bandRows?.[0]?.id || '');
    setItems(tasks);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, ledBandIds]);

  useEffect(() => { load(); }, [load]);

  async function handleComplete(task) {
    setItems((prev) => prev.filter((t) => t.key !== task.key));
    const { error } = await supabase.from('tasks').update({ done: true, done_at: new Date().toISOString() }).eq('id', task.id);
    if (error) { notify("Couldn't complete: " + error.message); load(); }
  }

  async function handleAdd(e) {
    e.preventDefault();
    if (!title.trim() || !addBandId) return;
    setAdding(true);
    const { error } = await supabase.from('tasks').insert({
      band_id: addBandId,
      title: title.trim(),
      due_date: dueDate || null,
      created_by: me?.id,
    });
    setAdding(false);
    if (error) { notify("Couldn't add task: " + error.message); return; }
    setTitle('');
    setDueDate('');
    load();
  }

  function handleRowClick(item) {
    if (item.kind === 'needs_invoicing' && item.gig_id) onNavigate?.({ url: '/gigs', gig_id: item.gig_id });
  }

  // Not gated on ledBandIds/bandOptions any more -- a real admin sees
  // this even though they lead zero bands themselves.
  return (
    <div className="day-sheet__section" style={{ marginTop: 16 }}>
      <h3 className="day-sheet__section-title">✅ Tasks</h3>

      {loading ? (
        <p className="state-message">Loading tasks…</p>
      ) : items.length === 0 ? (
        <p className="state-message">Nothing needs attention right now.</p>
      ) : (
        <ul className="simple-list">
          {items.map((item) => (
            <li className="simple-list__item" key={item.key}>
              <div className="simple-list__row">
                <div
                  onClick={() => handleRowClick(item)}
                  style={{ cursor: item.kind === 'needs_invoicing' ? 'pointer' : 'default' }}
                >
                  <span className="simple-list__title">
                    {item.kind !== 'manual' && (KIND_ICON[item.kind] || '') + ' '}
                    {item.title}
                  </span>
                  <span className="simple-list__subtitle">
                    {item.band_name}
                    {item.due_date ? ' · due ' + item.due_date : ''}
                  </span>
                </div>
                {item.kind === 'manual' && (
                  <div className="simple-list__actions">
                    <button type="button" className="link-button" onClick={() => handleComplete(item)}>Done</button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {bandOptions.length > 0 && (
        <form className="inline-subform" onSubmit={handleAdd} style={{ marginTop: 12, display: 'flex', flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <input
            placeholder="Add a task (e.g. Renew PLI insurance)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{ flex: '1 1 220px' }}
          />
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={{ flex: '0 1 160px' }} />
          {bandOptions.length > 1 && (
            <select value={addBandId} onChange={(e) => setAddBandId(e.target.value)} style={{ flex: '0 1 180px' }}>
              {bandOptions.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <button type="submit" className="btn btn--primary btn--small" disabled={adding || !title.trim()}>
            {adding ? 'Adding…' : '+ Add'}
          </button>
        </form>
      )}
    </div>
  );
}

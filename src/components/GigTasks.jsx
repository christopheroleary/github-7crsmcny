import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useCurrentProfile } from '../context/ProfileContext.jsx';
import { useIsOffline } from '../hooks/useIsOffline.js';
import { isLikelyOfflineError } from '../utils/networkError.js';
import CollapsibleSection from './CollapsibleSection.jsx';
import { TasksIcon } from '../utils/gigSectionIcons.jsx';
import { notify } from '../utils/toastService.js';

// Gig-scoped counterpart to TasksWidget.jsx's cross-band Dashboard list --
// only manual tasks tied to THIS gig_id, no derived items (those are
// band-wide by nature -- needs-invoicing/anniversary/uninvited-dep don't
// belong to one specific gig the way "confirm parking with the venue"
// does), so there's nothing to duplicate between the two surfaces.
export default function GigTasks({ gigId, bandId, defaultOpen, cachedTasks = [], refreshSignal }) {
  const { profile: me } = useCurrentProfile();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  // Without this, a failed fetch left `tasks` at its initial [] and this
  // rendered "No open tasks for this gig" -- indistinguishable from
  // genuinely having none, when what actually happened is there's no
  // signal to check. usingCache means it fell back to cachedTasks instead
  // -- adding/completing a task still needs a signal (read-only offline
  // support, no write queue), so those controls stay as they are and just
  // fail with their own error if tried.
  const [loadError, setLoadError] = useState(null);
  const [usingCache, setUsingCache] = useState(false);
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('tasks')
      .select('id, title, due_date, done')
      .eq('gig_id', gigId)
      .eq('done', false)
      .order('due_date', { ascending: true, nullsFirst: false });
    if (error) {
      // A genuine (non-network) error is surfaced honestly even when
      // cachedTasks exists, rather than silently hiding it behind a
      // "connection trouble" banner that would misdescribe what actually
      // happened.
      if (cachedTasks.length > 0 && isLikelyOfflineError(error)) {
        setTasks(cachedTasks);
        setUsingCache(true);
        setLoadError(null);
      } else {
        setUsingCache(false);
        setLoadError(isLikelyOfflineError(error) ? "Couldn't load tasks — no signal." : "Couldn't load tasks: " + error.message);
      }
    } else {
      setTasks(data || []);
      setLoadError(null);
      setUsingCache(false);
    }
    setLoading(false);
  }, [gigId, cachedTasks]);

  // Re-fetches the moment connectivity returns, and also whenever the gig
  // page's own "↻ Refresh" button is clicked (refreshSignal) -- previously
  // neither retried this section at all.
  const isOffline = useIsOffline(load);
  useEffect(() => { load(); }, [load, refreshSignal]);

  async function handleAdd(e) {
    e.preventDefault();
    if (!title.trim()) return;
    setAdding(true);
    const { error } = await supabase.from('tasks').insert({
      band_id: bandId,
      gig_id: gigId,
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

  async function handleComplete(task) {
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
    const { error } = await supabase.from('tasks').update({ done: true, done_at: new Date().toISOString() }).eq('id', task.id);
    if (error) { notify("Couldn't complete: " + error.message); load(); }
  }

  return (
    <CollapsibleSection id="gig-section-tasks" title="Tasks" icon={<TasksIcon />} defaultOpen={defaultOpen}>
      {usingCache && (
        <p className="field__hint" style={{ marginBottom: 10, color: 'var(--rust)' }}>
          {isOffline ? '● Offline' : '⚠ Connection trouble'} — showing tasks as they were last saved to this device. Adding or completing one needs a signal.
        </p>
      )}
      {loading ? (
        <p className="state-message">Loading tasks…</p>
      ) : loadError ? (
        <p className="state-message state-message--error">{loadError}</p>
      ) : tasks.length === 0 ? (
        <p className="state-message">No open tasks for this gig.</p>
      ) : (
        <ul className="simple-list">
          {tasks.map((t) => (
            <li className="simple-list__item" key={t.id}>
              <div className="simple-list__row">
                <div>
                  <span className="simple-list__title">{t.title}</span>
                  {t.due_date && <span className="simple-list__subtitle">due {t.due_date}</span>}
                </div>
                <div className="simple-list__actions">
                  <button type="button" className="link-button" onClick={() => handleComplete(t)}>Done</button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form className="inline-subform" onSubmit={handleAdd} style={{ marginTop: 12, display: 'flex', flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <input
          placeholder="e.g. Confirm load-in time with venue"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{ flex: '1 1 220px' }}
        />
        <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={{ flex: '0 1 160px' }} />
        <button type="submit" className="btn btn--primary btn--small" disabled={adding || !title.trim()}>
          {adding ? 'Adding…' : '+ Add'}
        </button>
      </form>
    </CollapsibleSection>
  );
}

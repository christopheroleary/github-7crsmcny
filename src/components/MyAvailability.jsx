import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { notify } from '../utils/toastService.js';
import { confirmAsync } from '../utils/confirmService.js';
import { todayStr, formatShortDate } from '../utils/formatDate.js';
import InfoTooltip from './InfoTooltip.jsx';
import DateInput from './DateInput.jsx';

// UK week order (Monday first) for display -- unrelated to Date.getDay()'s
// fixed 0=Sunday indexing used elsewhere to look these columns up by date.
const DAYS = [
  { key: 'avail_mon', label: 'Mon' },
  { key: 'avail_tue', label: 'Tue' },
  { key: 'avail_wed', label: 'Wed' },
  { key: 'avail_thu', label: 'Thu' },
  { key: 'avail_fri', label: 'Fri' },
  { key: 'avail_sat', label: 'Sat' },
  { key: 'avail_sun', label: 'Sun' },
];

const AVAILABLE_COLOUR = '#2f7d4f';
const UNAVAILABLE_COLOUR = '#b6452c'; // matches --rust, stable across all UI themes

const MAX_RANGE_DAYS = 60;

// UTC-only date-string arithmetic, deliberately never touching local time --
// parsing "2026-08-20T00:00:00" as local midnight and reading it back via
// toISOString() shifts the date by a day during BST (UTC+1), the same class
// of DST bug already fixed elsewhere in this codebase (see formatDate.js).
function datesBetween(start, end) {
  const dates = [];
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  const cur = new Date(Date.UTC(sy, sm - 1, sd));
  const last = new Date(Date.UTC(ey, em - 1, ed));
  while (cur <= last) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

// Reused for both the musician's own profile page and the admin's per-
// musician view — profileId is always explicit, same convention as
// MyExpenses/MyIncome. Feeds the admin-side dep-finder wizard: a weekly
// default pattern set once, plus a short blackout list for exceptions,
// so it stays a 10-second job rather than a chore.
export default function MyAvailability({ profileId }) {
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState({});
  const [savingDay, setSavingDay] = useState(null);
  const [blackouts, setBlackouts] = useState([]);
  const [adding, setAdding] = useState(false);
  const [rangeStart, setRangeStart] = useState(todayStr());
  const [rangeEnd, setRangeEnd] = useState(todayStr());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: profile }, { data: dates }] = await Promise.all([
      supabase.from('profiles').select(DAYS.map((d) => d.key).join(',')).eq('id', profileId).single(),
      supabase
        .from('musician_unavailable_dates')
        .select('*')
        .eq('profile_id', profileId)
        .gte('date', todayStr())
        .order('date'),
    ]);
    setDays(profile || {});
    setBlackouts(dates || []);
    setLoading(false);
  }, [profileId]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleDay(key) {
    const next = !days[key];
    setDays((d) => ({ ...d, [key]: next }));
    setSavingDay(key);
    const { error: saveError } = await supabase.from('profiles').update({ [key]: next }).eq('id', profileId);
    setSavingDay(null);
    if (saveError) {
      setDays((d) => ({ ...d, [key]: !next }));
      notify("Couldn't save: " + saveError.message);
    }
  }

  function startAdd() {
    setRangeStart(todayStr());
    setRangeEnd(todayStr());
    setNote('');
    setError(null);
    setAdding(true);
  }

  async function handleAddRange(e) {
    e.preventDefault();
    setError(null);

    if (rangeEnd < rangeStart) {
      setError('End date is before the start date.');
      return;
    }
    const dates = datesBetween(rangeStart, rangeEnd);
    if (dates.length > MAX_RANGE_DAYS) {
      setError(`That's ${dates.length} days — pick ${MAX_RANGE_DAYS} or fewer at a time.`);
      return;
    }

    setSaving(true);
    const { error: saveError } = await supabase
      .from('musician_unavailable_dates')
      .upsert(
        dates.map((date) => ({ profile_id: profileId, date, note: note.trim() || null })),
        { onConflict: 'profile_id,date', ignoreDuplicates: true }
      );
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    setAdding(false);
    load();
  }

  async function handleRemove(row) {
    const ok = await confirmAsync(`Remove ${formatShortDate(row.date)} from your unavailable dates?`);
    if (!ok) return;
    const { error: deleteError } = await supabase.from('musician_unavailable_dates').delete().eq('id', row.id);
    if (deleteError) {
      notify("Couldn't remove: " + deleteError.message);
      return;
    }
    load();
  }

  if (loading) return null;

  return (
    <div className="day-sheet__section">
      <h3 className="day-sheet__section-title">
        Availability
        <InfoTooltip text="Tap the days you're generally free to be booked, and add specific dates you're away for. This is what admin sees when looking for a dep — takes a few seconds, saves right away." />
      </h3>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {DAYS.map((d) => {
          const on = Boolean(days[d.key]);
          const colour = on ? AVAILABLE_COLOUR : UNAVAILABLE_COLOUR;
          return (
            <button
              key={d.key}
              type="button"
              onClick={() => toggleDay(d.key)}
              disabled={savingDay === d.key}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 12px',
                borderRadius: 20,
                border: '1px solid ' + colour + '55',
                background: colour + '1f',
                color: colour,
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              <span aria-hidden="true">{on ? '✓' : '✕'}</span>
              <span style={{ textDecoration: on ? 'none' : 'line-through' }}>{d.label}</span>
            </button>
          );
        })}
      </div>

      {!adding && (
        <button className="btn btn--ghost btn--small" style={{ marginBottom: 12 }} onClick={startAdd}>
          + Add unavailable dates
        </button>
      )}

      {adding && (
        <form className="inline-subform" onSubmit={handleAddRange} style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <label className="field" style={{ flex: '1 1 140px' }}>
              <span className="field__label">From</span>
              <DateInput value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} required />
            </label>
            <label className="field" style={{ flex: '1 1 140px' }}>
              <span className="field__label">To</span>
              <DateInput value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} required />
            </label>
          </div>
          <label className="field">
            <span className="field__label">Note (optional)</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. On holiday" />
          </label>
          {error && <p className="form-error">{error}</p>}
          <div className="form-actions">
            <button type="button" className="btn btn--ghost btn--small" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary btn--small" disabled={saving}>
              {saving ? 'Saving…' : 'Add'}
            </button>
          </div>
        </form>
      )}

      {blackouts.length === 0 && <p className="field__hint">No unavailable dates coming up.</p>}

      {blackouts.length > 0 && (
        <ul className="simple-list">
          {blackouts.map((row) => (
            <li className="simple-list__item" key={row.id}>
              <div className="simple-list__row">
                <div>
                  <span className="simple-list__title">{formatShortDate(row.date)}</span>
                  {row.note && <span className="simple-list__subtitle">{row.note}</span>}
                </div>
                <button className="link-button link-button--danger" onClick={() => handleRemove(row)}>
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

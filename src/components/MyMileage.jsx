import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { notify } from '../utils/toastService.js';
import { confirmAsync } from '../utils/confirmService.js';
import { todayStr, formatShortDate } from '../utils/formatDate.js';
import DateInput from './DateInput.jsx';
import SearchBox from './SearchBox.jsx';
import { useFuzzySearch } from '../hooks/useFuzzySearch.js';

// Reused for both the musician's own profile page and the admin's per-
// musician view -- same convention as MyExpenses/MyIncome. Business miles
// NOT tied to a gig (buying gear, a rehearsal, meeting a client) -- gig
// mileage is already captured per-gig via the travel calculator, and rolls
// into the combined mileage allowance tracker on Tax records automatically.
export default function MyMileage({ profileId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [date, setDate] = useState(todayStr());
  const [miles, setMiles] = useState('');
  const [purpose, setPurpose] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('mileage')
      .select('*')
      .eq('profile_id', profileId)
      .order('date', { ascending: false });
    setRows(data || []);
    setLoading(false);
  }, [profileId]);

  useEffect(() => {
    load();
  }, [load]);

  function startAdd() {
    setDate(todayStr());
    setMiles('');
    setPurpose('');
    setError(null);
    setAdding(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    if (!purpose.trim()) {
      setError('Add a purpose.');
      setSaving(false);
      return;
    }
    const milesNum = Number(miles);
    if (!milesNum || milesNum <= 0) {
      setError('Enter a valid number of miles.');
      setSaving(false);
      return;
    }

    const { error: saveError } = await supabase.from('mileage').insert({
      profile_id: profileId,
      date,
      miles: milesNum,
      purpose: purpose.trim(),
    });

    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }

    setAdding(false);
    load();
  }

  async function handleDelete(row) {
    const ok = await confirmAsync(`Delete "${row.purpose}" (${row.miles} mi)? This cannot be undone.`);
    if (!ok) return;
    const { error } = await supabase.from('mileage').delete().eq('id', row.id);
    if (error) {
      notify("Couldn't delete: " + error.message);
      return;
    }
    load();
  }

  const { query, setQuery, results: filteredRows } = useFuzzySearch(rows, ['purpose']);

  if (loading) return null;

  const total = rows.reduce((sum, r) => sum + Number(r.miles), 0);

  return (
    <div className="day-sheet__section">
      <h3 className="day-sheet__section-title">Other mileage</h3>
      <p className="field__hint" style={{ marginBottom: 12 }}>
        Business miles not tied to a gig — buying gear, a rehearsal, meeting a client. Gig mileage is tracked
        automatically; this tops up your mileage allowance total on Tax records below.
      </p>

      {!adding && (
        <button className="btn btn--ghost btn--small" style={{ marginBottom: 12 }} onClick={startAdd}>
          + Add mileage
        </button>
      )}

      {adding && (
        <form className="inline-subform" onSubmit={handleSubmit} style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <label className="field" style={{ flex: '1 1 140px' }}>
              <span className="field__label">Date</span>
              <DateInput value={date} onChange={(e) => setDate(e.target.value)} required />
            </label>
            <label className="field" style={{ flex: '1 1 100px' }}>
              <span className="field__label">Miles</span>
              <input
                type="number"
                step="0.1"
                min="0"
                value={miles}
                onChange={(e) => setMiles(e.target.value)}
                placeholder="0.0"
                required
              />
            </label>
          </div>
          <label className="field">
            <span className="field__label">Purpose</span>
            <input
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="e.g. Collecting PA speakers"
              required
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          <div className="form-actions">
            <button type="button" className="btn btn--ghost btn--small" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary btn--small" disabled={saving}>
              {saving ? 'Saving…' : 'Add mileage'}
            </button>
          </div>
        </form>
      )}

      {rows.length === 0 && <p className="field__hint">No mileage logged yet.</p>}

      {rows.length > 5 && (
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Search mileage…"
          resultCount={filteredRows.length}
          totalCount={rows.length}
        />
      )}

      {rows.length > 0 && filteredRows.length === 0 && (
        <p className="field__hint">No mileage matches "{query}".</p>
      )}

      {filteredRows.length > 0 && (
        <ul className="simple-list" style={{ marginTop: 8 }}>
          {filteredRows.map((row) => (
            <li className="simple-list__item" key={row.id}>
              <div className="simple-list__row">
                <div>
                  <span className="simple-list__title">
                    {row.purpose} — {row.miles} mi
                  </span>
                  <span className="simple-list__subtitle">{formatShortDate(row.date)}</span>
                </div>
                <button className="link-button link-button--danger" onClick={() => handleDelete(row)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {rows.length > 0 && (
        <p style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-muted)', marginTop: 8 }}>
          Total: <strong style={{ color: 'var(--ink)' }}>{total.toFixed(1)} mi</strong>
        </p>
      )}
    </div>
  );
}

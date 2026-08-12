import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { notify } from '../utils/toastService.js';
import { confirmAsync } from '../utils/confirmService.js';
import { INCOME_CATEGORIES } from '../utils/incomeCategories.js';
import { todayStr, formatShortDate } from '../utils/formatDate.js';
import DateInput from './DateInput.jsx';
import NumberInput from './NumberInput.jsx';
import SearchBox from './SearchBox.jsx';
import { useFuzzySearch } from '../hooks/useFuzzySearch.js';

function poundsFromPence(p) {
  return (p / 100).toFixed(2);
}

// Mirrors MyExpenses.jsx exactly -- same reusable-via-profileId shape, same
// reasoning for admin visibility -- just the other side of the ledger:
// money in that didn't come through a gig claim (selling gear, teaching,
// a one-off session, royalties).
export default function MyIncome({ profileId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [date, setDate] = useState(todayStr());
  const [category, setCategory] = useState(INCOME_CATEGORIES[0]);
  const [description, setDescription] = useState('');
  const [amountPounds, setAmountPounds] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('income')
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
    setCategory(INCOME_CATEGORIES[0]);
    setDescription('');
    setAmountPounds('');
    setError(null);
    setAdding(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    if (!description.trim()) {
      setError('Add a description.');
      setSaving(false);
      return;
    }
    const amountPence = Math.round(Number(amountPounds) * 100);
    if (!amountPence || amountPence <= 0) {
      setError('Enter a valid amount.');
      setSaving(false);
      return;
    }

    const { error: saveError } = await supabase.from('income').insert({
      profile_id: profileId,
      date,
      category,
      description: description.trim(),
      amount_pence: amountPence,
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
    const ok = await confirmAsync(
      `Delete "${row.description}" (£${poundsFromPence(row.amount_pence)})? This cannot be undone.`
    );
    if (!ok) return;
    const { error } = await supabase.from('income').delete().eq('id', row.id);
    if (error) {
      notify("Couldn't delete: " + error.message);
      return;
    }
    load();
  }

  const { query, setQuery, results: filteredRows } = useFuzzySearch(rows, ['description', 'category']);

  if (loading) return null;

  const total = rows.reduce((sum, r) => sum + r.amount_pence, 0);

  return (
    <div className="day-sheet__section">
      <h3 className="day-sheet__section-title">Other income</h3>
      <p className="field__hint" style={{ marginBottom: 12 }}>
        Money in that isn't from a gig claim — selling gear, teaching, a one-off session, royalties.
      </p>

      {!adding && (
        <button className="btn btn--ghost btn--small" style={{ marginBottom: 12 }} onClick={startAdd}>
          + Add income
        </button>
      )}

      {adding && (
        <form className="inline-subform" onSubmit={handleSubmit} style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <label className="field" style={{ flex: '1 1 140px' }}>
              <span className="field__label">Date</span>
              <DateInput value={date} onChange={(e) => setDate(e.target.value)} required />
            </label>
            <label className="field" style={{ flex: '1 1 180px' }}>
              <span className="field__label">Category</span>
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                {INCOME_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          </div>
          <label className="field">
            <span className="field__label">Description</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Sold old PA speakers"
              required
            />
          </label>
          <label className="field">
            <span className="field__label">Amount (£)</span>
            <NumberInput decimals={2} min={0} prefix="£" value={amountPounds} onChange={(e) => setAmountPounds(e.target.value)} placeholder="0.00" required />
          </label>
          {error && <p className="form-error">{error}</p>}
          <div className="form-actions">
            <button type="button" className="btn btn--ghost btn--small" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary btn--small" disabled={saving}>
              {saving ? 'Saving…' : 'Add income'}
            </button>
          </div>
        </form>
      )}

      {rows.length === 0 && <p className="field__hint">No other income logged yet.</p>}

      {rows.length > 5 && (
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Search other income…"
          resultCount={filteredRows.length}
          totalCount={rows.length}
        />
      )}

      {rows.length > 0 && filteredRows.length === 0 && (
        <p className="field__hint">No income matches "{query}".</p>
      )}

      {filteredRows.length > 0 && (
        <ul className="simple-list" style={{ marginTop: 8 }}>
          {filteredRows.map((row) => (
            <li className="simple-list__item" key={row.id}>
              <div className="simple-list__row">
                <div>
                  <span className="simple-list__title">
                    {row.description} — £{poundsFromPence(row.amount_pence)}
                  </span>
                  <span className="simple-list__subtitle">
                    {row.category} · {formatShortDate(row.date)}
                  </span>
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
          Total: <strong style={{ color: 'var(--ink)' }}>£{poundsFromPence(total)}</strong>
        </p>
      )}
    </div>
  );
}

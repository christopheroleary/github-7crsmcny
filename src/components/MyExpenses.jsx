import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { notify } from '../utils/toastService.js';
import { confirmAsync } from '../utils/confirmService.js';
import { EXPENSE_CATEGORIES } from '../utils/expenseCategories.js';
import { todayStr, formatShortDate } from '../utils/formatDate.js';

function poundsFromPence(p) {
  return (p / 100).toFixed(2);
}

// Reused for both the musician's own profile page and the admin's per-
// musician view on the Musicians list -- profileId is always explicit
// rather than assumed to be "me", so the same component works either way.
export default function MyExpenses({ profileId }) {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [date, setDate] = useState(todayStr());
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [description, setDescription] = useState('');
  const [amountPounds, setAmountPounds] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('expenses')
      .select('*')
      .eq('profile_id', profileId)
      .order('date', { ascending: false });
    setExpenses(data || []);
    setLoading(false);
  }, [profileId]);

  useEffect(() => {
    load();
  }, [load]);

  function startAdd() {
    setDate(todayStr());
    setCategory(EXPENSE_CATEGORIES[0]);
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

    const { error: saveError } = await supabase.from('expenses').insert({
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

  async function handleDelete(expense) {
    const ok = await confirmAsync(
      `Delete "${expense.description}" (£${poundsFromPence(expense.amount_pence)})? This cannot be undone.`
    );
    if (!ok) return;
    const { error } = await supabase.from('expenses').delete().eq('id', expense.id);
    if (error) {
      notify("Couldn't delete: " + error.message);
      return;
    }
    load();
  }

  if (loading) return null;

  const total = expenses.reduce((sum, e) => sum + e.amount_pence, 0);

  return (
    <div className="day-sheet__section">
      <h3 className="day-sheet__section-title">Expenses</h3>
      <p className="field__hint" style={{ marginBottom: 12 }}>
        Personal business costs — equipment, subscriptions, accountancy fees, and so on — for your own tax records.
        Not tied to any gig or claim.
      </p>

      {expenses.length === 0 && !adding && (
        <p className="field__hint">No expenses logged yet.</p>
      )}

      {expenses.length > 0 && (
        <ul className="simple-list">
          {expenses.map((exp) => (
            <li className="simple-list__item" key={exp.id}>
              <div className="simple-list__row">
                <div>
                  <span className="simple-list__title">
                    {exp.description} — £{poundsFromPence(exp.amount_pence)}
                  </span>
                  <span className="simple-list__subtitle">
                    {exp.category} · {formatShortDate(exp.date)}
                  </span>
                </div>
                <button className="link-button link-button--danger" onClick={() => handleDelete(exp)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {expenses.length > 0 && (
        <p style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-muted)', marginTop: 8 }}>
          Total: <strong style={{ color: 'var(--ink)' }}>£{poundsFromPence(total)}</strong>
        </p>
      )}

      {!adding && (
        <button className="btn btn--ghost btn--small" style={{ marginTop: 12 }} onClick={startAdd}>
          + Add expense
        </button>
      )}

      {adding && (
        <form className="inline-subform" onSubmit={handleSubmit} style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <label className="field" style={{ flex: '1 1 140px' }}>
              <span className="field__label">Date</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </label>
            <label className="field" style={{ flex: '1 1 180px' }}>
              <span className="field__label">Category</span>
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          </div>
          <label className="field">
            <span className="field__label">Description</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Website hosting renewal"
              required
            />
          </label>
          <label className="field">
            <span className="field__label">Amount (£)</span>
            <input
              type="number"
              step="0.01"
              value={amountPounds}
              onChange={(e) => {
                const v = e.target.value;
                if (v === '' || /^\d*\.?\d{0,2}$/.test(v)) setAmountPounds(v);
              }}
              placeholder="0.00"
              required
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          <div className="form-actions">
            <button type="button" className="btn btn--ghost btn--small" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary btn--small" disabled={saving}>
              {saving ? 'Saving…' : 'Add expense'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

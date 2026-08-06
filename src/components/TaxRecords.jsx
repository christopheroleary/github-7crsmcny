import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { taxYearOptions } from '../utils/taxYear.js';
import { SA103_EXPENSE_BOX, SA103_TURNOVER_BOX, SA103_OTHER_INCOME_BOX } from '../utils/sa103Boxes.js';

function poundsFromPence(p) {
  return (p / 100).toFixed(2);
}

function csvEscape(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function groupSum(rows) {
  const map = {};
  rows.forEach((r) => {
    map[r.category] = (map[r.category] || 0) + r.amount_pence;
  });
  return map;
}

// The one place income and expenses come together into a period-scoped
// summary + export. Deliberately not a tax calculation -- just organised
// records, ready to hand to an accountant or a bridging tool.
//
// Income is every line item from *paid* claims (not gig_lineup.fee_pence --
// that's the admin's planning figure, this is what was actually invoiced
// and received), bucketed by the gig's date since musician_claims has no
// separate "date paid" column to bucket by instead. Expenses are the
// standalone expenses table, bucketed by its own date column.
export default function TaxRecords({ profileId }) {
  const [loading, setLoading] = useState(true);
  const options = taxYearOptions();
  const [startYear, setStartYear] = useState(options[0].startYear);
  const [income, setIncome] = useState([]);
  const [outstandingPence, setOutstandingPence] = useState(0);
  const [expenseRows, setExpenseRows] = useState([]);
  const [otherIncomeRows, setOtherIncomeRows] = useState([]);

  const period = options.find((o) => o.startYear === startYear) || options[0];

  const load = useCallback(async () => {
    setLoading(true);

    const [{ data: claims }, { data: expenses }, { data: otherIncome }] = await Promise.all([
      supabase
        .from('musician_claims')
        .select('id, status, gigs(gig_date, venues(name)), musician_claim_items(category, description, amount_pence)')
        .eq('profile_id', profileId)
        .in('status', ['paid', 'approved']),
      supabase
        .from('expenses')
        .select('*')
        .eq('profile_id', profileId)
        .gte('date', period.start)
        .lte('date', period.end)
        .order('date'),
      supabase
        .from('income')
        .select('*')
        .eq('profile_id', profileId)
        .gte('date', period.start)
        .lte('date', period.end)
        .order('date'),
    ]);

    const paidItems = [];
    let outstanding = 0;
    (claims || []).forEach((c) => {
      const gigDate = c.gigs?.gig_date;
      if (!gigDate || gigDate < period.start || gigDate > period.end) return;
      const venue = c.gigs?.venues?.name || 'a gig';
      const items = c.musician_claim_items || [];
      if (c.status === 'paid') {
        items.forEach((item) => paidItems.push({ date: gigDate, venue, ...item }));
      } else {
        outstanding += items.reduce((s, i) => s + i.amount_pence, 0);
      }
    });

    setIncome(paidItems);
    setOutstandingPence(outstanding);
    setExpenseRows(expenses || []);
    setOtherIncomeRows(otherIncome || []);
    setLoading(false);
  }, [profileId, period.start, period.end]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return null;

  const incomeTotal = income.reduce((sum, i) => sum + i.amount_pence, 0);
  const otherIncomeTotal = otherIncomeRows.reduce((sum, r) => sum + r.amount_pence, 0);
  const expenseTotal = expenseRows.reduce((sum, e) => sum + e.amount_pence, 0);
  const incomeByCategory = groupSum(income);
  const otherIncomeByCategory = groupSum(otherIncomeRows);
  const expenseByCategory = groupSum(expenseRows);
  const hasData = income.length > 0 || expenseRows.length > 0 || otherIncomeRows.length > 0;

  function handleExport() {
    const lines = [
      '# These figures reflect what has been marked paid in Gig Manager. If you were paid a different amount, or paid outside the app, your real records may differ -- always check against your bank statement before filing.',
      ['Date', 'Type', 'Category', 'Description', 'Amount (GBP)'].join(','),
    ];
    income.forEach((i) =>
      lines.push([i.date, 'Gig income', i.category, csvEscape(i.description + ' — ' + i.venue), poundsFromPence(i.amount_pence)].join(','))
    );
    otherIncomeRows.forEach((r) =>
      lines.push([r.date, 'Other income', r.category, csvEscape(r.description), poundsFromPence(r.amount_pence)].join(','))
    );
    expenseRows.forEach((e) =>
      lines.push([e.date, 'Expense', e.category, csvEscape(e.description), poundsFromPence(e.amount_pence)].join(','))
    );
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tax-records-${period.label.replace('/', '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="day-sheet__section">
      <h3 className="day-sheet__section-title">Tax records</h3>
      <p className="field__hint" style={{ marginBottom: 12 }}>
        Income from paid claims and expenses logged for the tax year below — your own records for
        Self Assessment / Making Tax Digital. Not a tax calculation, just organised data ready to export.
      </p>

      <div className="offline-banner">
        ⚠ These figures reflect what's been marked <strong>paid</strong> in this system. If you were paid a
        different amount, or paid outside the app, your real records may differ — always check against your
        bank statement before filing.
      </div>

      <select
        value={startYear}
        onChange={(e) => setStartYear(Number(e.target.value))}
        style={{ marginBottom: 16, padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--paper)', color: 'var(--ink)' }}
      >
        {options.map((o) => (
          <option key={o.startYear} value={o.startYear}>{o.label} tax year</option>
        ))}
      </select>

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <p className="field__label" style={{ margin: '0 0 2px' }}>Gig income (paid claims)</p>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, margin: 0 }}>£{poundsFromPence(incomeTotal)}</p>
        </div>
        <div>
          <p className="field__label" style={{ margin: '0 0 2px' }}>Other income</p>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, margin: 0 }}>£{poundsFromPence(otherIncomeTotal)}</p>
        </div>
        <div>
          <p className="field__label" style={{ margin: '0 0 2px' }}>Expenses logged</p>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, margin: 0 }}>£{poundsFromPence(expenseTotal)}</p>
        </div>
      </div>

      {outstandingPence > 0 && (
        <p className="field__hint" style={{ marginBottom: 16 }}>
          £{poundsFromPence(outstandingPence)} approved for this period but not yet marked paid — not included above.
        </p>
      )}

      <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ minWidth: 180 }}>
          <p className="field__label">Gig income by category</p>
          <p className="field__hint" style={{ margin: '0 0 6px' }}>
            All counts as Turnover — {SA103_TURNOVER_BOX.full} full form / {SA103_TURNOVER_BOX.short} short form,
            regardless of category (HMRC doesn't split income the way it splits expenses).
          </p>
          {Object.keys(incomeByCategory).length === 0 && <p className="field__hint">None this year.</p>}
          {Object.entries(incomeByCategory).map(([cat, pence]) => (
            <div key={cat} style={{ fontSize: 13, display: 'flex', justifyContent: 'space-between', gap: 16 }}>
              <span>{cat}</span><span>£{poundsFromPence(pence)}</span>
            </div>
          ))}
        </div>
        <div style={{ minWidth: 180 }}>
          <p className="field__label">Other income by category</p>
          <p className="field__hint" style={{ margin: '0 0 6px' }}>
            {SA103_OTHER_INCOME_BOX.full} full form / {SA103_OTHER_INCOME_BOX.short} short form.
          </p>
          {Object.keys(otherIncomeByCategory).length === 0 && <p className="field__hint">None this year.</p>}
          {Object.entries(otherIncomeByCategory).map(([cat, pence]) => (
            <div key={cat} style={{ fontSize: 13, display: 'flex', justifyContent: 'space-between', gap: 16 }}>
              <span>{cat}</span><span>£{poundsFromPence(pence)}</span>
            </div>
          ))}
        </div>
        <div style={{ minWidth: 180 }}>
          <p className="field__label">Expenses by category</p>
          <p className="field__hint" style={{ margin: '0 0 6px' }}>
            Full-form (SA103F) box shown per category. Short form (SA103S) totals these into one figure, Box 20.
          </p>
          {Object.keys(expenseByCategory).length === 0 && <p className="field__hint">None this year.</p>}
          {Object.entries(expenseByCategory).map(([cat, pence]) => (
            <div key={cat} style={{ fontSize: 13, display: 'flex', justifyContent: 'space-between', gap: 16 }}>
              <span>{cat}{SA103_EXPENSE_BOX[cat] ? ` (${SA103_EXPENSE_BOX[cat]})` : ''}</span><span>£{poundsFromPence(pence)}</span>
            </div>
          ))}
        </div>
      </div>

      <button className="btn btn--ghost btn--small" onClick={handleExport} disabled={!hasData}>
        ⬇ Export CSV
      </button>
    </div>
  );
}

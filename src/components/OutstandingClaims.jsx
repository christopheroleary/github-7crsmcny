import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { formatShortDate } from '../utils/formatDate.js';

function poundsFromPence(p) {
  return (p / 100).toFixed(2);
}

// "Who owes me money right now" -- not tax-year scoped (unlike TaxRecords),
// since what's owed doesn't stop being relevant just because the tax year
// rolled over. Pulled straight from claim status: pending/approved claims
// haven't been paid yet, by definition.
export default function OutstandingClaims({ profileId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('musician_claims')
      .select('id, status, gigs(gig_date, venues(name)), musician_claim_items(amount_pence)')
      .eq('profile_id', profileId)
      .in('status', ['pending', 'approved']);
    setRows(
      (data || [])
        .map((c) => ({
          id: c.id,
          status: c.status,
          gigDate: c.gigs?.gig_date || null,
          venue: c.gigs?.venues?.name || 'a gig',
          totalPence: (c.musician_claim_items || []).reduce((s, i) => s + i.amount_pence, 0),
        }))
        .sort((a, b) => (a.gigDate || '').localeCompare(b.gigDate || ''))
    );
    setLoading(false);
  }, [profileId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return null;

  const total = rows.reduce((sum, r) => sum + r.totalPence, 0);

  return (
    <div className="day-sheet__section">
      <h3 className="day-sheet__section-title">Outstanding</h3>
      <p className="field__hint" style={{ marginBottom: 12 }}>
        Claims submitted but not yet marked paid.
      </p>

      {rows.length === 0 && <p className="field__hint">Nothing outstanding.</p>}

      {rows.length > 0 && (
        <>
          <ul className="simple-list">
            {rows.map((r) => (
              <li className="simple-list__item" key={r.id}>
                <div className="simple-list__row">
                  <div>
                    <span className="simple-list__title">{r.venue} — £{poundsFromPence(r.totalPence)}</span>
                    <span className="simple-list__subtitle">
                      {formatShortDate(r.gigDate)} · {r.status === 'approved' ? 'Approved, awaiting payment' : 'Awaiting review'}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <p style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-muted)', marginTop: 8 }}>
            Total outstanding: <strong style={{ color: 'var(--ink)' }}>£{poundsFromPence(total)}</strong>
          </p>
        </>
      )}
    </div>
  );
}

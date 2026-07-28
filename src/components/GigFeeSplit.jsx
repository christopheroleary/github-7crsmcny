import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { calculateFeeSplit } from '../utils/feeSplit.js';

function poundsFromPence(pence) {
  return (pence / 100).toFixed(2);
}

// A person's fee stacks every applicable role — someone who plays an
// instrument AND does DJ duties gets both, rather than one or the other.
function feeForRow(row, split) {
  let fee = 0;
  if (row.instrument_id) fee += split.perMusicianBasePence;
  if (row.vocal_role === 'lead') fee += split.singerBonusPence;
  if (row.is_captain) fee += split.captainBonusPence + split.remainderPence;
  if (row.is_dj) fee += split.djFeePence;
  if (row.is_roadie) fee += split.roadieFeePence;
  return fee;
}

export default function GigFeeSplit({ gigId, feeAmount, bandId, estimatedTravelPence }) {
  const [lineup, setLineup] = useState([]);
  const [template, setTemplate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [calculating, setCalculating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: lineupData }, { data: bandData }] = await Promise.all([
      supabase
        .from('gig_lineup')
        .select('id, instrument_id, vocal_role, is_captain, is_dj, is_roadie, travel_cost_pence, fee_pence, profiles(full_name), instruments(name), placeholder_musicians(name)')
        .eq('gig_id', gigId),
      bandId
        ? supabase.from('bands').select('fee_split_musician_base_pct, fee_split_singer_bonus_pct, fee_split_captain_bonus_pct, fee_split_dj_pct, fee_split_roadie_pct').eq('id', bandId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    setLineup(lineupData || []);
    setTemplate(bandData || null);
    setLoading(false);
  }, [gigId, bandId]);

  useEffect(() => { load(); }, [load]);

  const totalFeePence = feeAmount != null ? Math.round(Number(feeAmount) * 100) : 0;
  const regularCount = lineup.filter((l) => l.instrument_id).length;
  const hasSinger = lineup.some((l) => l.vocal_role === 'lead');
  const hasCaptain = lineup.some((l) => l.is_captain);
  const djCount = lineup.filter((l) => l.is_dj).length;
  const roadieCount = lineup.filter((l) => l.is_roadie).length;
  const actualTravelPence = lineup.reduce((sum, l) => sum + (l.travel_cost_pence || 0), 0);
  const fuelPence = actualTravelPence > 0 ? actualTravelPence : (estimatedTravelPence || 0);

  const hasTemplate = template && [
    template.fee_split_musician_base_pct,
    template.fee_split_singer_bonus_pct,
    template.fee_split_captain_bonus_pct,
    template.fee_split_dj_pct,
    template.fee_split_roadie_pct,
  ].some((v) => v != null);

  async function handleCalculate() {
    if (!hasTemplate || totalFeePence <= 0) return;
    setCalculating(true);
    const split = calculateFeeSplit({
      totalFeePence,
      regularCount,
      hasSinger,
      hasCaptain,
      djCount,
      roadieCount,
      fuelPence,
      template,
    });
    for (const row of lineup) {
      const fee = feeForRow(row, split);
      await supabase.from('gig_lineup').update({ fee_pence: fee }).eq('id', row.id);
    }
    setCalculating(false);
    load();
  }

  async function handleOverride(entryId, pounds) {
    const pence = pounds === '' ? null : Math.round(Number(pounds) * 100);
    await supabase.from('gig_lineup').update({ fee_pence: pence }).eq('id', entryId);
    load();
  }

  if (loading) return <p className="state-message">Loading fee split…</p>;
  if (lineup.length === 0) return null;

  const allocatedPence = lineup.reduce((sum, l) => sum + (l.fee_pence || 0), 0);
  const remainingPence = totalFeePence - allocatedPence - fuelPence;

  return (
    <div className="roster-section">
      <h3 className="roster-section__title">Fee split</h3>

      {!hasTemplate && (
        <p className="field__hint">This band has no fee split defaults set — add them on the band's edit page to auto-calculate.</p>
      )}
      {hasTemplate && totalFeePence <= 0 && (
        <p className="field__hint">Set a fee on this gig to calculate a split.</p>
      )}

      <table className="travel-table" style={{ marginTop: 8 }}>
        <thead>
          <tr><th>Musician</th><th>Role</th><th>Fee</th></tr>
        </thead>
        <tbody>
          {lineup.map((l) => {
            const name = l.profiles?.full_name || l.placeholder_musicians?.name || 'Unknown';
            const role = [l.instruments?.name, l.is_dj && 'DJ', l.is_roadie && 'Roadie', l.is_captain && 'Captain'].filter(Boolean).join(' + ') || '—';
            return (
              <tr key={l.id}>
                <td>{name}</td>
                <td>{role}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    £
                    <input
                      type="number"
                      step="1"
                      min="0"
                      defaultValue={l.fee_pence != null ? poundsFromPence(l.fee_pence) : ''}
                      onBlur={(e) => handleOverride(l.id, e.target.value)}
                      style={{ width: 80, border: '1px solid var(--line)', borderRadius: 6, padding: '4px 6px' }}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <dl className="detail-list" style={{ marginTop: 12 }}>
        <dt>Total fee</dt><dd>£{poundsFromPence(totalFeePence)}</dd>
        <dt>Allocated to musicians</dt><dd>£{poundsFromPence(allocatedPence)}</dd>
        <dt>Fuel</dt>
        <dd>
          £{poundsFromPence(fuelPence)}
          {actualTravelPence === 0 && estimatedTravelPence > 0 && <span className="field__hint"> (estimated — not yet calculated)</span>}
        </dd>
        <dt>Remaining margin</dt>
        <dd>
          <strong style={{ color: remainingPence < 0 ? 'var(--rust)' : 'inherit' }}>£{poundsFromPence(remainingPence)}</strong>
        </dd>
      </dl>

      <button
        type="button"
        className="btn btn--primary btn--small"
        style={{ marginTop: 8 }}
        onClick={handleCalculate}
        disabled={calculating || !hasTemplate || totalFeePence <= 0}
      >
        {calculating ? 'Calculating…' : 'Calculate fees'}
      </button>
    </div>
  );
}

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { calculateFeeSplit } from '../utils/feeSplit.js';
import { notify } from '../utils/toastService.js';
import NumberInput from './NumberInput.jsx';

function poundsFromPence(pence) {
  return (pence / 100).toFixed(2);
}

// A person's fee stacks every applicable role — someone who plays an
// instrument AND does DJ duties gets both, rather than one or the other.
function feeForRow(row, split) {
  let fee = 0;
  if (row.instrument_id) fee += split.perMusicianBasePence;
  if (row.vocal_role === 'lead') fee += split.singerBonusPence;
  if (row.is_captain) fee += split.captainBonusPence;
  if (row.is_dj) fee += split.djFeePence;
  if (row.is_roadie) fee += split.roadieFeePence;
  return fee;
}

// Captain always leads the list; a pure DJ/roadie (no instrument, so not
// actually performing) sinks to the bottom. Everyone else keeps roster order.
function rosterSortKey(entry) {
  if (entry.is_captain) return 0;
  if (!entry.instrument_id && (entry.is_dj || entry.is_roadie)) return 2;
  return 1;
}

export default function GigFeeSplit({ gigId, feeAmount, bandId, estimatedTravelPence, plannedHeadcount }) {
  const [lineup, setLineup] = useState([]);
  const [template, setTemplate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: lineupData }, { data: bandData }] = await Promise.all([
      supabase
        .from('gig_lineup')
        .select('id, instrument_id, vocal_role, is_captain, is_dj, is_roadie, travel_cost_pence, lift_share, fee_pence, profiles(full_name), instruments(name), placeholder_musicians(name)')
        .eq('gig_id', gigId),
      bandId
        ? supabase.from('bands').select('fee_split_owner_profit_pct, fee_split_singer_bonus_pct, fee_split_captain_bonus_pct, fee_split_dj_pct, fee_split_roadie_pct').eq('id', bandId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    setLineup(lineupData || []);
    setTemplate(bandData || null);
    setLoading(false);
  }, [gigId, bandId]);

  useEffect(() => { load(); }, [load]);

  const totalFeePence = feeAmount != null ? Math.round(Number(feeAmount) * 100) : 0;
  const regularCount = lineup.filter((l) => l.instrument_id).length;
  // Until the roster is fully booked, split against the intended final
  // headcount rather than however many are on it so far — otherwise the
  // first few musicians booked see an inflated per-person share that then
  // drops once the rest are added and it's recalculated.
  const usingPlannedHeadcount = plannedHeadcount && plannedHeadcount > regularCount;
  const effectiveRegularCount = usingPlannedHeadcount ? plannedHeadcount : regularCount;
  const hasSinger = lineup.some((l) => l.vocal_role === 'lead');
  const hasCaptain = lineup.some((l) => l.is_captain);
  const djCount = lineup.filter((l) => l.is_dj).length;
  const roadieCount = lineup.filter((l) => l.is_roadie).length;
  // Lift-share rows genuinely cost £0 — only rows with neither a calculated
  // cost nor lift-share are "unknown" (no home location set yet). Their fuel
  // gets predicted from the average of whoever's already calculated, since
  // people going to the same gig tend to travel similar distances; falling
  // back to the gig's pre-roster estimate if nobody's calculated yet.
  const knownRows = lineup.filter((l) => l.travel_cost_pence != null && !l.lift_share);
  const unknownRows = lineup.filter((l) => l.travel_cost_pence == null && !l.lift_share);
  const knownTravelSum = knownRows.reduce((sum, l) => sum + l.travel_cost_pence, 0);
  const knownAvgPence = knownRows.length > 0 ? Math.round(knownTravelSum / knownRows.length) : null;
  const predictedPerUnknownPence = knownAvgPence != null
    ? knownAvgPence
    : (estimatedTravelPence && lineup.length > 0 ? Math.round(estimatedTravelPence / lineup.length) : 0);
  const actualTravelPence = lineup.reduce((sum, l) => sum + (l.travel_cost_pence || 0), 0);
  const predictedTravelPence = unknownRows.length * predictedPerUnknownPence;
  const fuelPence = actualTravelPence + predictedTravelPence;

  const hasTemplate = template && [
    template.fee_split_owner_profit_pct,
    template.fee_split_singer_bonus_pct,
    template.fee_split_captain_bonus_pct,
    template.fee_split_dj_pct,
    template.fee_split_roadie_pct,
  ].some((v) => v != null);

  // No band settings at all (every fee_split_*_pct null) isn't a blocker —
  // calculateFeeSplit already treats a null percentage as 0%, so an unset
  // band naturally computes an equal split of the fee across the roster
  // (no owner profit, no captain/singer/DJ/roadie bonus) rather than
  // needing someone to explicitly configure that as a "template" first.
  const split = (totalFeePence > 0 && effectiveRegularCount > 0)
    ? calculateFeeSplit({ totalFeePence, regularCount: effectiveRegularCount, hasSinger, hasCaptain, djCount, roadieCount, fuelPence, template })
    : null;

  function goToBandSettings() {
    if (bandId) window.dispatchEvent(new CustomEvent('navigate-to-band', { detail: { band_id: bandId } }));
  }

  async function handleCalculate() {
    if (!split) return;
    setCalculating(true);
    setError(null);
    for (const row of lineup) {
      const fee = feeForRow(row, split);
      const { error: updateError } = await supabase.from('gig_lineup').update({ fee_pence: fee }).eq('id', row.id);
      if (updateError) {
        setError(updateError.message);
        setCalculating(false);
        return;
      }
    }
    setCalculating(false);
    load();
  }

  async function handleOverride(entryId, pounds) {
    const pence = pounds === '' ? null : Math.round(Number(pounds) * 100);
    const { error: updateError } = await supabase.from('gig_lineup').update({ fee_pence: pence }).eq('id', entryId);
    if (updateError) {
      notify("Couldn't save fee: " + updateError.message);
      return;
    }
    load();
  }

  if (loading) return <p className="state-message">Loading fee split…</p>;
  if (lineup.length === 0) return null;

  const allocatedPence = lineup.reduce((sum, l) => sum + (l.fee_pence || 0), 0);
  const remainingPence = totalFeePence - allocatedPence - fuelPence;
  const sortedLineup = [...lineup].sort((a, b) => rosterSortKey(a) - rosterSortKey(b));

  // The fees shown in the table are whatever was stored the last time
  // "Calculate fees" was clicked — if the roster (or fee/fuel) has changed
  // since, a fresh calculation would produce different numbers. Flag that
  // explicitly rather than letting the warning below read like it contradicts
  // the table.
  const hasStoredFees = lineup.some((l) => l.fee_pence != null);
  const isStale = hasStoredFees && split && Math.abs(allocatedPence - split.allocatedPence) > lineup.length;

  return (
    <div className="roster-section">
      <h3 className="roster-section__title">Fee split</h3>

      {!hasTemplate && (
        <p className="field__hint">
          No custom split set for this band — splitting the fee equally instead.{' '}
          <button type="button" className="link-button" onClick={goToBandSettings}>Set percentages for this band →</button>
        </p>
      )}
      {totalFeePence <= 0 && (
        <p className="field__hint">Set a fee on this gig to calculate a split.</p>
      )}
      {totalFeePence > 0 && effectiveRegularCount === 0 && (
        <p className="field__hint">Add at least one musician to the roster to calculate a split.</p>
      )}
      {usingPlannedHeadcount && (
        <p className="field__hint">
          Only {regularCount} of the planned {plannedHeadcount} musicians are booked so far — splitting against the planned
          headcount so early fees don't overstate what's left once everyone's added.
        </p>
      )}
      {isStale && (
        <p className="form-error">
          ⚠ The fees below are from an earlier calculation — the roster, fee, or fuel has changed since. Click "Calculate
          fees" to refresh them.
        </p>
      )}

      <div style={{ overflowX: 'auto', marginTop: 8 }}>
      <table className="travel-table">
        <thead>
          <tr><th>Musician</th><th>Role</th><th>Fee</th></tr>
        </thead>
        <tbody>
          {sortedLineup.map((l) => {
            const name = l.profiles?.full_name || l.placeholder_musicians?.name || 'Unknown';
            const role = [l.instruments?.name, l.vocal_role === 'lead' && 'Singer', l.is_dj && 'DJ', l.is_roadie && 'Roadie', l.is_captain && 'Captain'].filter(Boolean).join(' + ') || '—';
            return (
              <tr key={l.id}>
                <td>{name}</td>
                <td>{role}</td>
                <td>
                  <NumberInput
                    min={0}
                    prefix="£"
                    value={l.fee_pence != null ? poundsFromPence(l.fee_pence) : ''}
                    onChange={() => {}}
                    onClose={(finalValue) => handleOverride(l.id, finalValue)}
                    style={{ width: 80 }}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>

      <dl className="detail-list" style={{ marginTop: 12 }}>
        <dt>Total fee</dt><dd>£{poundsFromPence(totalFeePence)}</dd>
        {split && <><dt>Owner / band-leader profit</dt><dd>£{poundsFromPence(split.ownerProfitPence)} — not paid to any musician</dd></>}
        <dt>Allocated to musicians</dt><dd>£{poundsFromPence(allocatedPence)}</dd>
        <dt>Fuel</dt>
        <dd>
          £{poundsFromPence(fuelPence)}
          {unknownRows.length > 0 && (
            <span className="field__hint">
              {' '}(£{poundsFromPence(actualTravelPence)} calculated + £{poundsFromPence(predictedTravelPence)} predicted for {unknownRows.length} without a set home location)
            </span>
          )}
        </dd>
        <dt>Remaining margin</dt>
        <dd>
          <strong style={{ color: remainingPence < 0 ? 'var(--rust)' : 'inherit' }}>£{poundsFromPence(remainingPence)}</strong>
        </dd>
      </dl>

      {split?.belowDjOrRoadie && (
        <p className="form-error">
          ⚠ {isStale ? 'If you recalculate now, e' : 'E'}ach musician would earn £{poundsFromPence(split.perMusicianBasePence)} —
          less than the DJ/roadie flat rate of £{poundsFromPence(Math.max(split.djFeePence, split.roadieFeePence))} — consider
          raising the fee or booking fewer musicians.
        </p>
      )}
      {error && <p className="form-error">Couldn't save fees: {error}</p>}

      <button
        type="button"
        className="btn btn--primary btn--small"
        style={{ marginTop: 8 }}
        onClick={handleCalculate}
        disabled={calculating || !split}
      >
        {calculating ? 'Calculating…' : 'Calculate fees'}
      </button>
    </div>
  );
}

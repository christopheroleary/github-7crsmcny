import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { useCurrentProfile } from '../context/ProfileContext.jsx';
import { taxYearOptions } from '../utils/taxYear.js';
import InfoTooltip from './InfoTooltip.jsx';

function poundsFromPence(p) {
  return (p / 100).toFixed(2);
}

// Same "paid claims = real income" definition as TaxRecords.jsx (not
// gig_lineup.fee_pence -- that's the admin's planning figure), just grouped
// by band instead of by SA103 category. A fresh query rather than a shared
// one with TaxRecords: this needs band_id/bands(name) through the gigs join,
// which TaxRecords has no reason to select, and keeping them independent
// means neither risks the other's accuracy.
//
// No profileId prop, deliberately -- always the current viewer's own id,
// read internally rather than trusted from a caller. Unlike TaxRecords
// (self OR admin-viewing-any-musician's records via MusiciansList),
// musician_claims/musician_claim_items RLS also lets a band leader read
// *another* musician's claims for gigs in bands the leader manages (needed
// for MusicianClaimsAdmin to approve them) -- so a "MyEarnings" reused with
// someone else's id wouldn't be blocked by RLS the way its name implies,
// it would silently render a partial, band-filtered slice of that other
// person's income as if it were the viewer's own. Removing the prop removes
// the possibility of that misuse entirely, now or in any future call site.
export default function MyEarnings({ ledBandIds = [] }) {
  const { profile } = useCurrentProfile();
  const profileId = profile?.id;
  const options = taxYearOptions();
  const [startYear, setStartYear] = useState(options[0].startYear);
  const [loading, setLoading] = useState(true);
  const [ledGroups, setLedGroups] = useState([]);
  const [playedGroups, setPlayedGroups] = useState([]);
  const [otherIncomePence, setOtherIncomePence] = useState(0);
  const [outstandingPence, setOutstandingPence] = useState(0);
  // Bumped on every load() call; a response only gets applied if it's still
  // the most recent request by the time it lands. Without this, rapidly
  // switching tax years can let an older, slower response overwrite a
  // newer one -- showing figures for the wrong year with no visible sign
  // anything's wrong, which is exactly the kind of silent inaccuracy this
  // feature can't afford.
  const requestIdRef = useRef(0);

  const period = options.find((o) => o.startYear === startYear) || options[0];

  const load = useCallback(async () => {
    if (!profileId) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);

    const [{ data: claims }, { data: otherIncome }] = await Promise.all([
      supabase
        .from('musician_claims')
        .select('status, gigs(gig_date, band_id, bands(name)), musician_claim_items(amount_pence)')
        .eq('profile_id', profileId)
        .in('status', ['paid', 'approved']),
      supabase
        .from('income')
        .select('amount_pence, date')
        .eq('profile_id', profileId)
        .gte('date', period.start)
        .lte('date', period.end),
    ]);

    if (requestId !== requestIdRef.current) return; // a newer request has since started -- discard this stale response

    // band_id -> { name, pence } -- 'none' buckets gigs with no band assigned
    // ("Other gigs") rather than dropping them.
    const byBand = {};
    let outstanding = 0;

    (claims || []).forEach((c) => {
      const gigDate = c.gigs?.gig_date;
      if (!gigDate || gigDate < period.start || gigDate > period.end) return;
      const itemsPence = (c.musician_claim_items || []).reduce((s, i) => s + i.amount_pence, 0);

      if (c.status !== 'paid') {
        outstanding += itemsPence;
        return;
      }

      const bandId = c.gigs?.band_id || 'none';
      const bandName = c.gigs?.bands?.name || 'Other gigs';
      if (!byBand[bandId]) byBand[bandId] = { name: bandName, pence: 0 };
      byBand[bandId].pence += itemsPence;
    });

    const led = [];
    const played = [];
    Object.entries(byBand).forEach(([bandId, { name, pence }]) => {
      (bandId !== 'none' && ledBandIds.includes(bandId) ? led : played).push({ bandId, name, pence });
    });
    led.sort((a, b) => b.pence - a.pence);
    played.sort((a, b) => b.pence - a.pence);

    setLedGroups(led);
    setPlayedGroups(played);
    setOtherIncomePence((otherIncome || []).reduce((s, r) => s + r.amount_pence, 0));
    setOutstandingPence(outstanding);
    setLoading(false);
  }, [profileId, period.start, period.end, ledBandIds]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <p className="state-message">Loading earnings…</p>;

  const totalPence =
    ledGroups.reduce((s, g) => s + g.pence, 0) +
    playedGroups.reduce((s, g) => s + g.pence, 0) +
    otherIncomePence;

  return (
    <div className="my-earnings">
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
        <select
          value={startYear}
          onChange={(e) => setStartYear(Number(e.target.value))}
          style={{ padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--paper)', color: 'var(--ink)' }}
        >
          {options.map((o) => (
            <option key={o.startYear} value={o.startYear}>{o.label} tax year</option>
          ))}
        </select>
        <InfoTooltip text="Runs the UK tax year, 6 April to 5 April. Only claims marked paid count here -- same cash-basis definition as Tax Records, so the two never disagree." />
      </div>

      {outstandingPence > 0 && (
        <p className="field__hint" style={{ marginBottom: 16 }}>
          £{poundsFromPence(outstandingPence)} approved for this period but not yet marked paid — not included below.
        </p>
      )}

      {totalPence === 0 && outstandingPence === 0 ? (
        <p className="state-message">No income recorded for this period.</p>
      ) : (
        <div className="tax-ledger">
          <div className="tax-ledger__col">
            <p className="tax-ledger__col-title">What you personally earned</p>

            {ledGroups.length > 0 && (
              <>
                <p className="tax-ledger__group-title">Bands &amp; acts you lead</p>
                {ledGroups.map((g) => (
                  <div key={g.bandId} className="tax-ledger__row">
                    <span>{g.name}</span><span className="tax-ledger__amount">£{poundsFromPence(g.pence)}</span>
                  </div>
                ))}
              </>
            )}

            {playedGroups.length > 0 && (
              <>
                <p className="tax-ledger__group-title" style={{ marginTop: ledGroups.length > 0 ? 14 : 0 }}>Bands you play for</p>
                {playedGroups.map((g) => (
                  <div key={g.bandId} className="tax-ledger__row">
                    <span>{g.name}</span><span className="tax-ledger__amount">£{poundsFromPence(g.pence)}</span>
                  </div>
                ))}
              </>
            )}

            {otherIncomePence > 0 && (
              <>
                <p className="tax-ledger__group-title" style={{ marginTop: (ledGroups.length > 0 || playedGroups.length > 0) ? 14 : 0 }}>Other income</p>
                <div className="tax-ledger__row">
                  <span>Non-gig income</span><span className="tax-ledger__amount">£{poundsFromPence(otherIncomePence)}</span>
                </div>
              </>
            )}

            <div className="tax-ledger__total">
              <span>Total earned</span><span className="tax-ledger__amount">£{poundsFromPence(totalPence)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { confirmAsync } from '../utils/confirmService.js';
import { promptAsync } from '../utils/promptService.js';
import { notify } from '../utils/toastService.js';

function sortedItems(claim) {
  return [...(claim.musician_claim_items || [])].sort((a, b) => a.sort_order - b.sort_order);
}

function claimTotalPence(claim) {
  return sortedItems(claim).reduce((sum, i) => sum + i.amount_pence, 0);
}

function poundsFromPence(p) {
  return (p / 100).toFixed(2);
}

const STATUS_COLORS = {
  pending: 'inquiry',
  approved: 'confirmed',
  paid: 'completed',
  rejected: 'cancelled',
};

export default function MusicianClaimsAdmin({ gigId }) {
  const [claims, setClaims] = useState([]);
  const [expectedByProfile, setExpectedByProfile] = useState({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data }, { data: lineup }] = await Promise.all([
      supabase
        .from('musician_claims')
        .select('*, profiles(full_name), musician_claim_items(*)')
        .eq('gig_id', gigId)
        .order('created_at'),
      // What the roster/fee-split view actually allocated this musician for
      // this gig -- fee_pence + travel_cost_pence -- to compare against what
      // they claimed. A musician no longer on the roster (removed after
      // claiming) has no entry here, so the comparison is simply skipped
      // for them rather than showing a misleading "expected £0" diff.
      supabase.from('gig_lineup').select('profile_id, fee_pence, travel_cost_pence').eq('gig_id', gigId),
    ]);
    const expected = {};
    (lineup || []).forEach((l) => {
      expected[l.profile_id] = (l.fee_pence || 0) + (l.travel_cost_pence || 0);
    });
    setExpectedByProfile(expected);
    setClaims(data || []);
    setLoading(false);
  }, [gigId]);

  useEffect(() => {
    load();
  }, [load]);

  async function updateStatus(claim, status) {
    const payload = { status };

    // Guard rail: warn if approving/paying a claim for someone no longer
    // on this gig's roster (e.g. removed after they submitted the claim).
    if (status === 'approved' || status === 'paid') {
      const { data: onRoster } = await supabase
        .from('gig_lineup')
        .select('id')
        .eq('gig_id', gigId)
        .eq('profile_id', claim.profile_id)
        .maybeSingle();
      if (!onRoster) {
        const name = claim.profiles?.full_name || 'This musician';
        const action = status === 'paid' ? 'mark it paid' : 'approve it';
        const ok = await confirmAsync(name + ' is no longer on this gig\'s roster. Still ' + action + '?');
        if (!ok) return;
      }
    }

    if (status === 'rejected') {
      const reason = await promptAsync(
        'Reason for rejecting this claim (optional, shown to the musician):',
        claim.notes || ''
      );
      if (reason === null) return; // cancelled
      payload.notes = reason || null;
    }

    const { error } = await supabase.from('musician_claims').update(payload).eq('id', claim.id);
    if (error) {
      notify("Couldn't update: " + error.message);
      return;
    }
    load();
  }

  if (loading) return null;
  if (claims.length === 0) return (
    <div className="roster-section">
      <h3 className="roster-section__title">Musician claims</h3>
      <p className="state-message" style={{ textAlign: 'left', padding: 0 }}>No payment claims submitted yet.</p>
    </div>
  );

  const total = claims.filter((c) => c.status !== 'rejected').reduce((sum, c) => sum + claimTotalPence(c), 0);

  return (
    <div className="roster-section">
      <h3 className="roster-section__title">Musician claims</h3>
      <ul className="simple-list">
        {claims.map((claim) => (
          <li className="simple-list__item" key={claim.id}>
            <div className="simple-list__row">
              <div>
                <span className="simple-list__title">
                  {claim.profiles?.full_name} — <strong>£{poundsFromPence(claimTotalPence(claim))}</strong>
                </span>
                {sortedItems(claim).map((item) => (
                  <span className="simple-list__subtitle" key={item.id}>
                    {item.category} · {item.description} — £{poundsFromPence(item.amount_pence)}
                  </span>
                ))}
                {claim.notes && <span className="simple-list__subtitle">{claim.notes}</span>}
                {expectedByProfile[claim.profile_id] != null && (() => {
                  const diff = claimTotalPence(claim) - expectedByProfile[claim.profile_id];
                  return diff === 0 ? (
                    <span className="status-tag status-tag--confirmed" style={{ marginTop: 4 }}>
                      Matches expected (£0.00 diff)
                    </span>
                  ) : (
                    <span className="status-tag status-tag--cancelled" style={{ marginTop: 4 }}>
                      ⚠ £{poundsFromPence(Math.abs(diff))} {diff > 0 ? 'over' : 'under'} expected
                    </span>
                  );
                })()}
              </div>
              <div className="simple-list__actions">
                <span className={'status-tag status-tag--' + STATUS_COLORS[claim.status]}>
                  {claim.status}
                </span>
                {claim.status === 'pending' && (
                  <>
                    <button className="link-button" onClick={() => updateStatus(claim, 'approved')}>Approve</button>
                    <button className="link-button link-button--danger" onClick={() => updateStatus(claim, 'rejected')}>Reject</button>
                  </>
                )}
                {claim.status === 'approved' && (
                  <button className="link-button" onClick={() => updateStatus(claim, 'paid')}>Mark paid</button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      <p style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 13, marginTop: 8, color: 'var(--text-muted)' }}>
        Total claimed: <strong style={{ color: 'var(--ink)' }}>£{poundsFromPence(total)}</strong>
      </p>
    </div>
  );
}
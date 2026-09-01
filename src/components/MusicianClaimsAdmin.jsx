import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { confirmAsync } from '../utils/confirmService.js';
import { promptAsync } from '../utils/promptService.js';
import { notify } from '../utils/toastService.js';
import { useCurrentProfile } from '../context/ProfileContext.jsx';
import CollapsibleSection from './CollapsibleSection.jsx';
import InfoTooltip from './InfoTooltip.jsx';

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

// gig_lineup's fee_pence/travel_cost_pence are only ever READ here (to
// compare against what a musician claimed), never written, so there's no
// need to fetch them independently -- GigDetail already has them loaded
// via useOfflineGigData and passes them straight through.
export default function MusicianClaimsAdmin({ gigId, lineup: lineupProp = [], defaultOpen = false }) {
  const { isPro } = useCurrentProfile();
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(true);
  const [payingId, setPayingId] = useState(null);

  // What the roster/fee-split view actually allocated this musician for
  // this gig -- fee_pence + travel_cost_pence -- to compare against what
  // they claimed. A musician no longer on the roster (removed after
  // claiming) has no entry here, so the comparison is simply skipped for
  // them rather than showing a misleading "expected £0" diff.
  const expectedByProfile = {};
  lineupProp.forEach((l) => {
    if (l.profile_id) expectedByProfile[l.profile_id] = (l.fee_pence || 0) + (l.travel_cost_pence || 0);
  });

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('musician_claims')
      .select('*, profiles(full_name, stripe_connect_status), musician_claim_items(*)')
      .eq('gig_id', gigId)
      .order('created_at');
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

  // The automated alternative to "Mark paid" -- only offered once the
  // musician's Connect account is actually active (checked server-side
  // too, this is just so the button doesn't appear for someone who isn't
  // ready yet). The claim only flips to 'paid' once Stripe confirms the
  // transfer went through -- see create-connect-transfer's own comment for
  // why that ordering matters.
  async function payViaStripe(claim) {
    setPayingId(claim.id);
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    const { data, error } = await supabase.functions.invoke('create-connect-transfer', {
      body: { claim_id: claim.id },
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    setPayingId(null);
    if (error || !data?.ok) {
      // supabase-js only parses the response body into `data` on a 2xx --
      // for a non-2xx it's `data: null, error: FunctionsHttpError`, whose
      // own .message is just the generic "non-2xx status code". The
      // function's actual reason (e.g. "insufficient funds") only comes
      // through by reading the raw response body error.context wraps.
      let serverMessage = data?.error || null;
      if (!serverMessage && error?.context?.json) {
        try {
          const body = await error.context.json();
          serverMessage = body?.error || null;
        } catch {
          // response body wasn't JSON -- fall through to the generic message
        }
      }
      notify("Couldn't pay via Stripe: " + (serverMessage || error?.message || 'unknown error'));
      return;
    }
    notify('Paid £' + poundsFromPence(data.amount_pence) + ' via Stripe.');
    load();
  }

  if (loading) return null;
  if (claims.length === 0) return (
    <CollapsibleSection
      id="gig-section-claims"
      title="Musician claims"
      defaultOpen={defaultOpen}
      titleExtra={<InfoTooltip text="Payment claims musicians submit after the gig — approve, reject, or pay them out (via Stripe if they're connected)." />}
    >
      <p className="state-message" style={{ textAlign: 'left', padding: 0 }}>No payment claims submitted yet.</p>
    </CollapsibleSection>
  );

  const total = claims.filter((c) => c.status !== 'rejected').reduce((sum, c) => sum + claimTotalPence(c), 0);

  return (
    <CollapsibleSection
      id="gig-section-claims"
      title="Musician claims"
      defaultOpen={defaultOpen}
      titleExtra={<InfoTooltip text="Payment claims musicians submit after the gig — approve, reject, or pay them out (via Stripe if they're connected)." />}
    >
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
                {claim.status === 'paid' && claim.stripe_transfer_id && (
                  <span className="status-tag status-tag--confirmed" style={{ marginTop: 4, fontSize: 10 }}>
                    Paid via Stripe
                  </span>
                )}
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
                  <>
                    {isPro && claim.profiles?.stripe_connect_status === 'active' && (
                      <button
                        className="link-button"
                        onClick={() => payViaStripe(claim)}
                        disabled={payingId === claim.id}
                      >
                        {payingId === claim.id ? 'Paying…' : 'Pay via Stripe'}
                      </button>
                    )}
                    <button className="link-button" onClick={() => updateStatus(claim, 'paid')}>Mark paid manually</button>
                  </>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      <p style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 13, marginTop: 8, color: 'var(--text-muted)' }}>
        Total claimed: <strong style={{ color: 'var(--ink)' }}>£{poundsFromPence(total)}</strong>
      </p>
    </CollapsibleSection>
  );
}
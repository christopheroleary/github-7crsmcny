import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';

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
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('musician_claims')
      .select('*, profiles(full_name)')
      .eq('gig_id', gigId)
      .order('created_at');
    setClaims(data || []);
    setLoading(false);
  }, [gigId]);

  useEffect(() => {
    load();
  }, [load]);

  async function updateStatus(claim, status) {
    const { error } = await supabase.from('musician_claims').update({ status }).eq('id', claim.id);
    if (error) {
      alert("Couldn't update: " + error.message);
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

  const total = claims.filter((c) => c.status !== 'rejected').reduce((sum, c) => sum + c.amount_pence, 0);

  return (
    <div className="roster-section">
      <h3 className="roster-section__title">Musician claims</h3>
      <ul className="simple-list">
        {claims.map((claim) => (
          <li className="simple-list__item" key={claim.id}>
            <div className="simple-list__row">
              <div>
                <span className="simple-list__title">{claim.profiles?.full_name}</span>
                <span className="simple-list__subtitle">
                  {claim.description} — <strong>£{poundsFromPence(claim.amount_pence)}</strong>
                </span>
                {claim.notes && <span className="simple-list__subtitle">{claim.notes}</span>}
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
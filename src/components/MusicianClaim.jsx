import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';

function poundsFromPence(p) {
  return (p / 100).toFixed(2);
}

const STATUS_LABELS = {
  pending: 'Awaiting admin review',
  approved: 'Approved — payment coming',
  paid: 'Paid',
  rejected: 'Rejected',
};

const STATUS_COLORS = {
  pending: 'inquiry',
  approved: 'confirmed',
  paid: 'completed',
  rejected: 'cancelled',
};

export default function MusicianClaim({ gigId, myProfileId }) {
  const [claim, setClaim] = useState(null);
  const [myLineup, setMyLineup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState('');
  const [amountPounds, setAmountPounds] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: claimData }, { data: lineupData }] = await Promise.all([
      supabase
        .from('musician_claims')
        .select('*')
        .eq('gig_id', gigId)
        .eq('profile_id', myProfileId)
        .maybeSingle(),
      supabase
        .from('gig_lineup')
        .select('travel_cost_pence, instrument_id, instruments(name)')
        .eq('gig_id', gigId)
        .eq('profile_id', myProfileId)
        .maybeSingle(),
    ]);
    setClaim(claimData);
    setMyLineup(lineupData);
    setLoading(false);
  }, [gigId, myProfileId]);

  useEffect(() => {
    load();
  }, [load]);

  function startCreate() {
    const travelPounds = myLineup?.travel_cost_pence
      ? (myLineup.travel_cost_pence / 100).toFixed(2)
      : '';
    setDescription('Performance fee' + (myLineup?.instruments?.name ? ' — ' + myLineup.instruments.name : ''));
    setAmountPounds(travelPounds ? '' : '');
    setNotes(travelPounds ? 'Includes £' + travelPounds + ' travel' : '');
    setEditing(true);
    setError(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const amountPence = Math.round(Number(amountPounds) * 100);
    if (!amountPence || amountPence <= 0) {
      setError('Please enter a valid amount.');
      setSaving(false);
      return;
    }

    const payload = {
      gig_id: gigId,
      profile_id: myProfileId,
      amount_pence: amountPence,
      description,
      notes: notes || null,
    };

    const { error } = claim
      ? await supabase.from('musician_claims').update({ amount_pence: amountPence, description, notes: notes || null }).eq('id', claim.id)
      : await supabase.from('musician_claims').insert(payload);

    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setEditing(false);
    load();
  }

  if (loading) return null;

  return (
    <div className="day-sheet__section">
      <h3 className="day-sheet__section-title">My payment claim</h3>

      {!claim && !editing && (
        <>
          {myLineup?.travel_cost_pence && (
            <p className="field__hint">
              Your calculated travel cost is £{poundsFromPence(myLineup.travel_cost_pence)} — you can include this in your claim.
            </p>
          )}
          <button className="btn btn--primary btn--small" style={{ marginTop: 8 }} onClick={startCreate}>
            Submit a claim for this gig
          </button>
        </>
      )}

      {claim && !editing && (
        <>
          <div className="claim-card">
            <div className="claim-card__row">
              <span className="claim-card__label">Amount</span>
              <span className="claim-card__amount">£{poundsFromPence(claim.amount_pence)}</span>
            </div>
            <div className="claim-card__row">
              <span className="claim-card__label">Description</span>
              <span>{claim.description}</span>
            </div>
            {claim.notes && (
              <div className="claim-card__row">
                <span className="claim-card__label">Notes</span>
                <span>{claim.notes}</span>
              </div>
            )}
            <div className="claim-card__row">
              <span className="claim-card__label">Status</span>
              <span className={'status-tag status-tag--' + STATUS_COLORS[claim.status]}>
                {STATUS_LABELS[claim.status]}
              </span>
            </div>
          </div>
          {claim.status === 'pending' && (
            <button
              className="link-button"
              style={{ marginTop: 8 }}
              onClick={() => {
                setDescription(claim.description);
                setAmountPounds((claim.amount_pence / 100).toFixed(2));
                setNotes(claim.notes || '');
                setEditing(true);
                setError(null);
              }}
            >
              Edit claim
            </button>
          )}
        </>
      )}

      {editing && (
        <form className="inline-subform" onSubmit={handleSubmit}>
          <label className="field">
            <span className="field__label">Description</span>
            <input value={description} onChange={(e) => setDescription(e.target.value)} required />
          </label>
          <label className="field">
            <span className="field__label">Total amount (£)</span>
            <input
              type="number"
              step="0.01"
              value={amountPounds}
              onChange={(e) => setAmountPounds(e.target.value)}
              placeholder="e.g. 150.00"
              required
            />
            {myLineup?.travel_cost_pence && (
              <span className="field__hint">
                Your travel is £{poundsFromPence(myLineup.travel_cost_pence)} — include this in your total if applicable.
              </span>
            )}
          </label>
          <label className="field">
            <span className="field__label">Notes (optional)</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </label>
          {error && <p className="form-error">{error}</p>}
          <div className="form-actions">
            <button type="button" className="btn btn--ghost btn--small" onClick={() => setEditing(false)}>Cancel</button>
            <button type="submit" className="btn btn--primary btn--small" disabled={saving}>
              {saving ? 'Saving…' : claim ? 'Update claim' : 'Submit claim'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
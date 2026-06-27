import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import GigForm from './GigForm.jsx';

export default function GigDetail({ gigId, onBack, onDeleted }) {
  const [gig, setGig] = useState(null);
  const [requirements, setRequirements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('gigs')
      .select('*, venues(name, address), clients(name)')
      .eq('id', gigId)
      .single();
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    setGig(data);

    const { data: reqs } = await supabase
      .from('gig_requirements')
      .select('quantity, instruments(name)')
      .eq('gig_id', gigId);
    setRequirements(reqs || []);
    setLoading(false);
  }, [gigId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDelete() {
    const ok = window.confirm(
      'Delete this gig? This also permanently deletes its lineup, setlist, and invoice records. This cannot be undone.'
    );
    if (!ok) return;
    const { error } = await supabase.from('gigs').delete().eq('id', gigId);
    if (error) {
      alert(`Couldn't delete: ${error.message}`);
      return;
    }
    onDeleted?.();
  }

  function handleSaved() {
    setEditing(false);
    load();
  }

  if (loading) return <p className="state-message">Loading gig…</p>;
  if (error) return <p className="state-message state-message--error">Couldn't load gig: {error}</p>;
  if (!gig) return null;

  if (editing) {
    return <GigForm gig={gig} onSaved={handleSaved} onCancel={() => setEditing(false)} />;
  }

  return (
    <div className="entity-detail">
      <button className="link-button" onClick={onBack}>← Back to gigs</button>

      <div className="section-header">
        <h2 className="section-header__title">{gig.venues?.name ?? 'No venue set'}</h2>
        <span className={`status-tag status-tag--${gig.status}`}>{gig.status}</span>
      </div>

      <dl className="detail-list">
        <dt>Date</dt><dd>{gig.gig_date}</dd>
        <dt>Client</dt><dd>{gig.clients?.name || '—'}</dd>
        <dt>Times</dt>
        <dd>
          {gig.load_in_time && `Load-in ${gig.load_in_time.slice(0, 5)} · `}
          {gig.soundcheck_time && `Soundcheck ${gig.soundcheck_time.slice(0, 5)} · `}
          {gig.start_time && `On stage ${gig.start_time.slice(0, 5)}`}
          {gig.end_time && ` – ${gig.end_time.slice(0, 5)}`}
        </dd>
        <dt>Fee</dt><dd>{gig.fee_amount != null ? `£${Number(gig.fee_amount).toFixed(2)}` : '—'}</dd>
        <dt>Venue address</dt><dd>{gig.venues?.address || '—'}</dd>
        <dt>Parking notes</dt><dd>{gig.parking_notes || '—'}</dd>
        <dt>Notes</dt><dd>{gig.notes || '—'}</dd>
        <dt>Instruments needed</dt>
        <dd>
          {requirements.length === 0
            ? '—'
            : requirements.map((r, i) => (
                <span key={i} className="tag" style={{ marginRight: 6 }}>
                  {r.instruments?.name} × {r.quantity}
                </span>
              ))}
        </dd>
      </dl>

      {/* Roster, vacancy tracking, setlist, and the map/directions button land here next */}

      <div className="form-actions">
        <button className="btn btn--ghost" onClick={handleDelete}>Delete gig</button>
        <button className="btn btn--primary" onClick={() => setEditing(true)}>Edit gig</button>
      </div>
    </div>
  );
}
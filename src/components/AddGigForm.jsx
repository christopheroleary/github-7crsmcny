import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

export default function AddGigForm({ onCreated, onCancel }) {
  const [venues, setVenues] = useState([]);
  const [venueId, setVenueId] = useState('');
  const [gigDate, setGigDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [status, setStatus] = useState('inquiry');
  const [feeAmount, setFeeAmount] = useState('');
  const [bandSizeRequired, setBandSizeRequired] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    supabase
      .from('venues')
      .select('id, name')
      .order('name')
      .then(({ data }) => {
        if (data) setVenues(data);
      });
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const { error } = await supabase.from('gigs').insert({
      venue_id: venueId || null,
      gig_date: gigDate,
      start_time: startTime || null,
      end_time: endTime || null,
      status,
      fee_amount: feeAmount === '' ? null : Number(feeAmount),
      band_size_required: bandSizeRequired === '' ? null : Number(bandSizeRequired),
      notes: notes || null,
    });

    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    onCreated?.();
  }

  return (
    <form className="entity-form" onSubmit={handleSubmit}>
      <label className="field">
        <span className="field__label">Venue</span>
        <select value={venueId} onChange={(e) => setVenueId(e.target.value)}>
          <option value="">No venue yet</option>
          {venues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </label>

      <div className="field-row">
        <label className="field">
          <span className="field__label">Date</span>
          <input type="date" value={gigDate} onChange={(e) => setGigDate(e.target.value)} required />
        </label>
        <label className="field">
          <span className="field__label">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="inquiry">Inquiry</option>
            <option value="confirmed">Confirmed</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
      </div>

      <div className="field-row">
        <label className="field">
          <span className="field__label">Start time</span>
          <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">End time</span>
          <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </label>
      </div>

      <div className="field-row">
        <label className="field">
          <span className="field__label">Fee (£)</span>
          <input type="number" step="0.01" value={feeAmount} onChange={(e) => setFeeAmount(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Band size needed</span>
          <input type="number" min="1" value={bandSizeRequired} onChange={(e) => setBandSizeRequired(e.target.value)} />
        </label>
      </div>

      <label className="field">
        <span className="field__label">Notes</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
      </label>

      {error && <p className="form-error">{error}</p>}

      <div className="form-actions">
        <button type="button" className="btn btn--ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn--primary" disabled={submitting}>
          {submitting ? 'Saving…' : 'Save gig'}
        </button>
      </div>
    </form>
  );
}
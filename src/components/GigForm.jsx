import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

export default function GigForm({ gig, onSaved, onCancel }) {
  const isEdit = Boolean(gig);
  const [venues, setVenues] = useState([]);
  const [clients, setClients] = useState([]);
  const [instruments, setInstruments] = useState([]);

  const [venueId, setVenueId] = useState(gig?.venue_id || '');
  const [clientId, setClientId] = useState(gig?.client_id || '');
  const [showNewClient, setShowNewClient] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newClientEmail, setNewClientEmail] = useState('');
  const [newClientPhone, setNewClientPhone] = useState('');

  const [gigDate, setGigDate] = useState(gig?.gig_date || '');
  const [startTime, setStartTime] = useState(gig?.start_time?.slice(0, 5) || '');
  const [endTime, setEndTime] = useState(gig?.end_time?.slice(0, 5) || '');
  const [loadInTime, setLoadInTime] = useState(gig?.load_in_time?.slice(0, 5) || '');
  const [soundcheckTime, setSoundcheckTime] = useState(gig?.soundcheck_time?.slice(0, 5) || '');
  const [status, setStatus] = useState(gig?.status || 'inquiry');
  const [feeAmount, setFeeAmount] = useState(gig?.fee_amount ?? '');
  const [parkingNotes, setParkingNotes] = useState(gig?.parking_notes || '');
  const [notes, setNotes] = useState(gig?.notes || '');

  const [requirements, setRequirements] = useState([]);
  const [originalRequirementIds, setOriginalRequirementIds] = useState([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    supabase.from('venues').select('id, name').order('name').then(({ data }) => setVenues(data || []));
    supabase.from('clients').select('id, name').order('name').then(({ data }) => setClients(data || []));
    supabase.from('instruments').select('id, name').order('sort_order').then(({ data }) => setInstruments(data || []));

    if (isEdit) {
      supabase
        .from('gig_requirements')
        .select('id, instrument_id, quantity')
        .eq('gig_id', gig.id)
        .then(({ data }) => {
          const rows = (data || []).map((r) => ({ id: r.id, instrument_id: r.instrument_id, quantity: r.quantity }));
          setRequirements(rows);
          setOriginalRequirementIds(rows.map((r) => r.id));
        });
    }
  }, [isEdit, gig?.id]);

  function addRequirementRow() {
    setRequirements([...requirements, { id: null, instrument_id: '', quantity: 1 }]);
  }
  function updateRequirementRow(index, field, value) {
    setRequirements(requirements.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  }
  function removeRequirementRow(index) {
    setRequirements(requirements.filter((_, i) => i !== index));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    let finalClientId = clientId || null;
    if (showNewClient && newClientName.trim()) {
      const { data: newClient, error: clientError } = await supabase
        .from('clients')
        .insert({ name: newClientName, email: newClientEmail || null, phone: newClientPhone || null })
        .select()
        .single();
      if (clientError) {
        setError(clientError.message);
        setSubmitting(false);
        return;
      }
      finalClientId = newClient.id;
    }

    const payload = {
      venue_id: venueId || null,
      client_id: finalClientId,
      gig_date: gigDate,
      start_time: startTime || null,
      end_time: endTime || null,
      load_in_time: loadInTime || null,
      soundcheck_time: soundcheckTime || null,
      status,
      fee_amount: feeAmount === '' ? null : Number(feeAmount),
      parking_notes: parkingNotes || null,
      notes: notes || null,
    };

    let gigId = gig?.id;
    if (isEdit) {
      const { error: updateError } = await supabase.from('gigs').update(payload).eq('id', gigId);
      if (updateError) {
        setError(updateError.message);
        setSubmitting(false);
        return;
      }
    } else {
      const { data: newGig, error: insertError } = await supabase.from('gigs').insert(payload).select().single();
      if (insertError) {
        setError(insertError.message);
        setSubmitting(false);
        return;
      }
      gigId = newGig.id;
    }

    const currentIds = requirements.filter((r) => r.id).map((r) => r.id);
    const toDelete = originalRequirementIds.filter((id) => !currentIds.includes(id));
    if (toDelete.length > 0) {
      const { error: delError } = await supabase.from('gig_requirements').delete().in('id', toDelete);
      if (delError) {
        setError(delError.message);
        setSubmitting(false);
        return;
      }
    }

    for (const r of requirements) {
      if (!r.instrument_id) continue;
      if (r.id) {
        const { error: updError } = await supabase
          .from('gig_requirements')
          .update({ instrument_id: r.instrument_id, quantity: Number(r.quantity) || 1 })
          .eq('id', r.id);
        if (updError) {
          setError(updError.message);
          setSubmitting(false);
          return;
        }
      } else {
        const { error: insError } = await supabase
          .from('gig_requirements')
          .insert({ gig_id: gigId, instrument_id: r.instrument_id, quantity: Number(r.quantity) || 1 });
        if (insError) {
          setError(insError.message);
          setSubmitting(false);
          return;
        }
      }
    }

    setSubmitting(false);
    onSaved?.(gigId);
  }

  return (
    <form className="entity-form" onSubmit={handleSubmit}>
      <label className="field">
        <span className="field__label">Venue</span>
        <select value={venueId} onChange={(e) => setVenueId(e.target.value)}>
          <option value="">No venue yet</option>
          {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </label>

      <div className="field">
        <span className="field__label">Client</span>
        {!showNewClient ? (
          <>
            <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">No client yet</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button type="button" className="link-button" onClick={() => setShowNewClient(true)}>+ New client instead</button>
          </>
        ) : (
          <div className="inline-subform">
            <input placeholder="Client name" value={newClientName} onChange={(e) => setNewClientName(e.target.value)} />
            <input placeholder="Email (optional)" value={newClientEmail} onChange={(e) => setNewClientEmail(e.target.value)} />
            <input placeholder="Phone (optional)" value={newClientPhone} onChange={(e) => setNewClientPhone(e.target.value)} />
            <button type="button" className="link-button" onClick={() => setShowNewClient(false)}>Cancel, pick existing instead</button>
          </div>
        )}
      </div>

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
          <span className="field__label">Load-in time</span>
          <input type="time" value={loadInTime} onChange={(e) => setLoadInTime(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Soundcheck time</span>
          <input type="time" value={soundcheckTime} onChange={(e) => setSoundcheckTime(e.target.value)} />
        </label>
      </div>

      <label className="field">
        <span className="field__label">Fee (£)</span>
        <input type="number" step="0.01" value={feeAmount} onChange={(e) => setFeeAmount(e.target.value)} />
      </label>

      <label className="field">
        <span className="field__label">Parking notes</span>
        <textarea value={parkingNotes} onChange={(e) => setParkingNotes(e.target.value)} rows={2} />
      </label>

      <label className="field">
        <span className="field__label">Notes</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
      </label>

      <div className="field">
        <span className="field__label">Instruments needed</span>
        {requirements.map((r, i) => (
          <div className="field-row requirement-row" key={r.id ?? `new-${i}`}>
            <select value={r.instrument_id} onChange={(e) => updateRequirementRow(i, 'instrument_id', e.target.value)}>
              <option value="">Choose instrument…</option>
              {instruments.map((inst) => <option key={inst.id} value={inst.id}>{inst.name}</option>)}
            </select>
            <input
              type="number"
              min="1"
              value={r.quantity}
              onChange={(e) => updateRequirementRow(i, 'quantity', e.target.value)}
              style={{ maxWidth: '70px' }}
            />
            <button type="button" className="btn btn--ghost btn--small" onClick={() => removeRequirementRow(i)}>Remove</button>
          </div>
        ))}
        <button type="button" className="link-button" onClick={addRequirementRow}>+ Add instrument requirement</button>
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="form-actions">
        <button type="button" className="btn btn--ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn--primary" disabled={submitting}>
          {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Save gig'}
        </button>
      </div>
    </form>
  );
}
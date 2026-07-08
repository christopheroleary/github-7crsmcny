import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import TimeInput from './TimeInput.jsx';
import AddressAutocomplete from './AddressAutocomplete.jsx';

export default function GigForm({ gig, onSaved, onCancel }) {
  const isEdit = Boolean(gig) && !gig._isConvert;
  const [bands, setBands] = useState([]);
  const [venues, setVenues] = useState([]);
  const [clients, setClients] = useState([]);
  const [instruments, setInstruments] = useState([]);

  // Band
  const [bandId, setBandId] = useState(gig?.band_id || '');
  const [showNewBand, setShowNewBand] = useState(false);
  const [newBandName, setNewBandName] = useState('');

  // Venue
  const [venueId, setVenueId] = useState(gig?.venue_id || '');
  // const [showNewVenue, setShowNewVenue] = useState(false);
  // const [newVenueName, setNewVenueName] = useState('');
  const [newVenueContact, setNewVenueContact] = useState('');
  const [newVenuePhone, setNewVenuePhone] = useState('');
  const [newVenueAddress, setNewVenueAddress] = useState('');
  const [newVenueLat, setNewVenueLat] = useState(null);
  const [newVenueLon, setNewVenueLon] = useState(null);

  // Client
  const [clientId, setClientId] = useState(gig?.client_id || '');
  // const [showNewClient, setShowNewClient] = useState(false);
  // const [newClientName, setNewClientName] = useState('');
  // const [newClientEmail, setNewClientEmail] = useState('');
  // const [newClientPhone, setNewClientPhone] = useState('');

  const [gigDate, setGigDate] = useState(gig?.gig_date || '');
  const [startTime, setStartTime] = useState(gig?.start_time?.slice(0, 5) || '');
  const [endTime, setEndTime] = useState(gig?.end_time?.slice(0, 5) || '');
  const [loadInTime, setLoadInTime] = useState(gig?.load_in_time?.slice(0, 5) || '');
  const [soundcheckTime, setSoundcheckTime] = useState(gig?.soundcheck_time?.slice(0, 5) || '');
  const [status, setStatus] = useState(gig?.status || 'inquiry');
  const [feeAmount, setFeeAmount] = useState(gig?.fee_amount != null ? Math.round(Number(gig.fee_amount)) : '');
  const [parkingNotes, setParkingNotes] = useState(gig?.parking_notes || '');
  const [notes, setNotes] = useState(gig?.notes || '');
  const [requirements, setRequirements] = useState([]);
  const [originalRequirementIds, setOriginalRequirementIds] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // for convert enquiries form entry to gig inquiry
  const [newClientName, setNewClientName] = useState(gig?._clientHint || '');
  const [newClientEmail, setNewClientEmail] = useState(gig?._clientEmail || '');
  const [newClientPhone, setNewClientPhone] = useState(gig?._clientPhone || '');
  const [showNewClient, setShowNewClient] = useState(Boolean(gig?._clientHint)); // ← auto-open if hint
  const [newVenueName, setNewVenueName] = useState(gig?._venueHint || '');
  const [showNewVenue, setShowNewVenue] = useState(Boolean(gig?._venueHint)); // ← auto-open if hint

  useEffect(() => {
    supabase.from('bands').select('id, name').order('name').then(({ data }) => setBands(data || []));
    supabase.from('venues').select('id, name').order('name').then(({ data }) => setVenues(data || []));
    supabase.from('clients').select('id, name').order('name').then(({ data }) => setClients(data || []));
    supabase.from('instruments').select('id, name').order('sort_order').then(({ data }) => setInstruments(data || []));
    if (isEdit) {
      supabase.from('gig_requirements').select('id, instrument_id, quantity').eq('gig_id', gig.id).then(({ data }) => {
        const rows = (data || []).map((r) => ({ id: r.id, instrument_id: r.instrument_id, quantity: r.quantity }));
        setRequirements(rows);
        setOriginalRequirementIds(rows.map((r) => r.id));
      });
    }
  }, [isEdit, gig?.id]);

  function addRequirementRow() { setRequirements([...requirements, { id: null, instrument_id: '', quantity: 1 }]); }
  function updateRequirementRow(i, field, value) { setRequirements(requirements.map((r, idx) => idx === i ? { ...r, [field]: value } : r)); }
  function removeRequirementRow(i) { setRequirements(requirements.filter((_, idx) => idx !== i)); }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    
    // Quick-create band
    let finalBandId = bandId || null;
    if (showNewBand && newBandName.trim()) {
      const { data: nb, error: be } = await supabase.from('bands').insert({ name: newBandName }).select().single();
      if (be) { setError(be.message); setSubmitting(false); return; }
      finalBandId = nb.id;
    }

    // Quick-create venue
    let finalVenueId = venueId || null;
    if (showNewVenue && newVenueName.trim()) {
      const { data: nv, error: ve } = await supabase.from('venues').insert({
        name: newVenueName,
        address: newVenueAddress || null,
        latitude: newVenueLat,
        longitude: newVenueLon,
        contact_name: newVenueContact || null,
        phone: newVenuePhone || null,
      }).select().single();
            if (ve) { setError(ve.message); setSubmitting(false); return; }
      finalVenueId = nv.id;
    }



    // Quick-create client
    let finalClientId = clientId || null;
    if (showNewClient && newClientName.trim()) {
      const { data: nc, error: ce } = await supabase.from('clients').insert({
        name: newClientName, email: newClientEmail || null, phone: newClientPhone || null,
      }).select().single();
      if (ce) { setError(ce.message); setSubmitting(false); return; }
      finalClientId = nc.id;
    }

    const payload = {
      band_id: finalBandId,
      venue_id: finalVenueId,
      client_id: finalClientId,
      gig_date: gigDate,
      start_time: startTime || null,
      end_time: endTime || null,
      load_in_time: loadInTime || null,
      soundcheck_time: soundcheckTime || null,
      status,
      fee_amount: feeAmount === '' ? null : Math.round(Number(feeAmount)),
      parking_notes: parkingNotes || null,
      notes: notes || null,
    };

    let gigId = gig?.id;
    if (isEdit) {
      const { error: ue } = await supabase.from('gigs').update(payload).eq('id', gigId);
      if (ue) { setError(ue.message); setSubmitting(false); return; }
    } else {
      const { data: ng, error: ie } = await supabase.from('gigs').insert(payload).select().single();
      if (ie) { setError(ie.message); setSubmitting(false); return; }
      gigId = ng.id;
    }

    const currentIds = requirements.filter((r) => r.id).map((r) => r.id);
    const toDelete = originalRequirementIds.filter((id) => !currentIds.includes(id));
    if (toDelete.length > 0) {
      const { error: de } = await supabase.from('gig_requirements').delete().in('id', toDelete);
      if (de) { setError(de.message); setSubmitting(false); return; }
    }
    for (const r of requirements) {
      if (!r.instrument_id) continue;
      if (r.id) {
        await supabase.from('gig_requirements').update({ instrument_id: r.instrument_id, quantity: Number(r.quantity) || 1 }).eq('id', r.id);
      } else {
        await supabase.from('gig_requirements').insert({ gig_id: gigId, instrument_id: r.instrument_id, quantity: Number(r.quantity) || 1 });
      }
    }

    setSubmitting(false);
    onSaved?.(gigId);
  }

  return (
    <form className="entity-form" onSubmit={handleSubmit}>

      {/* Band */}
      <div className="field">
        <span className="field__label">Band</span>
        {!showNewBand ? (
          <>
            <select value={bandId} onChange={(e) => setBandId(e.target.value)}>
              <option value="">No band set</option>
              {bands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <button type="button" className="link-button" onClick={() => setShowNewBand(true)}>+ Quick add band</button>
          </>
        ) : (
          <div className="inline-subform">
            <input placeholder="Band name" value={newBandName} onChange={(e) => setNewBandName(e.target.value)} required />
            <button type="button" className="link-button" onClick={() => setShowNewBand(false)}>Cancel, pick existing instead</button>
          </div>
        )}
      </div>

      {/* Venue */}
      <div className="field">
        <span className="field__label">Venue</span>
        {!showNewVenue ? (
          <>
            <select value={venueId} onChange={(e) => setVenueId(e.target.value)}>
              <option value="">No venue yet</option>
              {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <button type="button" className="link-button" onClick={() => setShowNewVenue(true)}>+ Quick add venue</button>
          </>
        ) : (
          <div className="inline-subform">
            <input placeholder="Venue name *" value={newVenueName} onChange={(e) => setNewVenueName(e.target.value)} required />
            <AddressAutocomplete
              value={newVenueAddress}
              onChange={(text) => { setNewVenueAddress(text); setNewVenueLat(null); setNewVenueLon(null); }}
              onCoordinatesChange={(lat, lon) => { setNewVenueLat(lat); setNewVenueLon(lon); }}
              placeholder="Address (start typing…)"
            />
            <input placeholder="Contact name (optional)" value={newVenueContact} onChange={(e) => setNewVenueContact(e.target.value)} />
            <input placeholder="Phone (optional)" value={newVenuePhone} onChange={(e) => setNewVenuePhone(e.target.value)} />
            <button type="button" className="link-button" onClick={() => setShowNewVenue(false)}>Cancel, pick existing instead</button>
          </div>
        )}
      </div>


      {/* Client */}
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
            <input placeholder="Client name" value={newClientName} onChange={(e) => setNewClientName(e.target.value)} required />
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
          <TimeInput id="start-time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">End time</span>
          <TimeInput id="end-time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </label>
      </div>

      <div className="field-row">
        <label className="field">
          <span className="field__label">Load-in time</span>
          <TimeInput id="loadin-time" value={loadInTime} onChange={(e) => setLoadInTime(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Soundcheck time</span>
          <TimeInput id="soundcheck-time" value={soundcheckTime} onChange={(e) => setSoundcheckTime(e.target.value)} />
        </label>
      </div>

      <label className="field">
        <span className="field__label">Fee (£) — whole number</span>
        <input
          type="number"
          step="1"
          min="0"
          value={feeAmount}
          onChange={(e) => setFeeAmount(e.target.value)}
          placeholder="e.g. 650"
        />
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
          <div className="field-row requirement-row" key={r.id ?? 'new-' + i}>
            <select value={r.instrument_id} onChange={(e) => updateRequirementRow(i, 'instrument_id', e.target.value)}>
              <option value="">Choose instrument…</option>
              {instruments.map((inst) => <option key={inst.id} value={inst.id}>{inst.name}</option>)}
            </select>
            <input type="number" min="1" value={r.quantity} onChange={(e) => updateRequirementRow(i, 'quantity', e.target.value)} style={{ maxWidth: 70 }} />
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
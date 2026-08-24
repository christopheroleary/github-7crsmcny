import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useCurrentProfile } from '../context/ProfileContext.jsx';
import TimeInput from './TimeInput.jsx';
import DateInput from './DateInput.jsx';
import NumberInput from './NumberInput.jsx';
import AddressAutocomplete from './AddressAutocomplete.jsx';
import { calculateFeeSplit } from '../utils/feeSplit.js';
import InfoTooltip from './InfoTooltip.jsx';

function poundsFromPence(pence) {
  return (pence / 100).toFixed(2);
}

// Matches the availability day-chips on MyProfile (green + tick for yes,
// red/rust + cross for no) -- these all directly change the profit/loss
// projection below, so they need to read as levers on the budget, not as
// ordinary unrelated checkboxes.
const CHIP_ON_COLOUR = '#2f7d4f';
const CHIP_OFF_COLOUR = '#b6452c';

function BudgetToggleChip({ label, checked, onChange }) {
  const colour = checked ? CHIP_ON_COLOUR : CHIP_OFF_COLOUR;
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '7px 12px',
        borderRadius: 20,
        border: '1px solid ' + colour + '55',
        background: colour + '1f',
        color: colour,
        fontWeight: 600,
        fontSize: 13,
        cursor: 'pointer',
      }}
    >
      <span aria-hidden="true">{checked ? '✓' : '✕'}</span>
      <span style={{ textDecoration: checked ? 'none' : 'line-through' }}>{label}</span>
    </button>
  );
}

// Presets describe a dress-code style rather than a specific garment (e.g.
// not "Suit" or "Dress"), so the same list reads correctly regardless of
// what any given musician is wearing.
const DRESS_CODE_PRESETS = [
  'Black tie / Formal',
  'Smart casual',
  'All black stagewear',
  'Band-branded stagewear',
  'Casual / Comfortable',
  'Themed / Costume',
  "Client's own dress code",
];

export default function GigForm({ gig, onSaved, onCancel }) {
  const { profile: me } = useCurrentProfile();
  const isEdit = Boolean(gig) && !gig._isConvert;
  const [bands, setBands] = useState([]);
  const [venues, setVenues] = useState([]);
  const [clients, setClients] = useState([]);
  const [instruments, setInstruments] = useState([]);
  const [songs, setSongs] = useState([]);

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
  const [guestCount, setGuestCount] = useState(gig?.guest_count != null ? gig.guest_count : '');
  const [eventType, setEventType] = useState(gig?.event_type || '');
  const [performanceType, setPerformanceType] = useState(gig?.performance_type || '');
  const [mileageRatePence, setMileageRatePence] = useState(gig?.mileage_rate_pence != null ? gig.mileage_rate_pence : 35);
  const [parkingNotes, setParkingNotes] = useState(gig?.parking_notes || '');
  const [notes, setNotes] = useState(gig?.notes || '');
  const [setsInfo, setSetsInfo] = useState(gig?.sets_info || '');
  const [dressCodePreset, setDressCodePreset] = useState(
    gig?.dress_code ? (DRESS_CODE_PRESETS.includes(gig.dress_code) ? gig.dress_code : '__other__') : ''
  );
  const [dressCodeOther, setDressCodeOther] = useState(
    gig?.dress_code && !DRESS_CODE_PRESETS.includes(gig.dress_code) ? gig.dress_code : ''
  );
  const [venueWifi, setVenueWifi] = useState(gig?.venue_wifi || '');

  // DJ details
  const [needsDj, setNeedsDj] = useState(gig?.needs_dj || false);
  const [djSongRules, setDjSongRules] = useState(gig?.dj_song_rules || '');
  const [firstDanceMode, setFirstDanceMode] = useState(gig?.first_dance_mode || '');
  const [firstDanceSongId, setFirstDanceSongId] = useState(gig?.first_dance_song_id || '');
  const [firstDanceSongTitle, setFirstDanceSongTitle] = useState('');

  // Roadie details
  const [needsRoadie, setNeedsRoadie] = useState(gig?.needs_roadie || false);
  const [roadieStageLayout, setRoadieStageLayout] = useState(gig?.roadie_stage_layout || '');
  const [roadieVanParking, setRoadieVanParking] = useState(gig?.roadie_van_parking || '');
  const [roadieContact, setRoadieContact] = useState(gig?.roadie_contact || '');
  const [requirements, setRequirements] = useState([]);
  const [originalRequirementIds, setOriginalRequirementIds] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [sameDayGigs, setSameDayGigs] = useState([]);

  // Budgeting — projects profit/loss before a roster exists
  const [plannedHeadcount, setPlannedHeadcount] = useState(gig?.planned_headcount ?? '');
  const [plannedHasCaptain, setPlannedHasCaptain] = useState(gig?.planned_has_captain || false);
  const [plannedHasSinger, setPlannedHasSinger] = useState(gig?.planned_has_singer || false);
  const [estimatedTravelPounds, setEstimatedTravelPounds] = useState(
    gig?.estimated_travel_pence != null ? poundsFromPence(gig.estimated_travel_pence) : ''
  );

  // for convert enquiries form entry to gig inquiry
  const [newClientName, setNewClientName] = useState(gig?._clientHint || '');
  const [newClientEmail, setNewClientEmail] = useState(gig?._clientEmail || '');
  const [newClientPhone, setNewClientPhone] = useState(gig?._clientPhone || '');
  const [showNewClient, setShowNewClient] = useState(Boolean(gig?._clientHint)); // ← auto-open if hint
  const [newVenueName, setNewVenueName] = useState(gig?._venueHint || '');
  const [showNewVenue, setShowNewVenue] = useState(Boolean(gig?._venueHint)); // ← auto-open if hint

  useEffect(() => {
    supabase.from('bands').select('id, name, fee_split_owner_profit_pct, fee_split_singer_bonus_pct, fee_split_captain_bonus_pct, fee_split_dj_pct, fee_split_roadie_pct').order('name').then(({ data }) => setBands(data || []));
    supabase.from('venues').select('id, name').order('name').then(({ data }) => setVenues(data || []));
    supabase.from('clients').select('id, name').order('name').then(({ data }) => setClients(data || []));
    supabase.from('instruments').select('id, name').order('sort_order').then(({ data }) => setInstruments(data || []));
    supabase.from('songs').select('id, title, artist').order('title').then(({ data }) => setSongs(data || []));
    if (isEdit) {
      supabase.from('gig_requirements').select('id, instrument_id, quantity').eq('gig_id', gig.id).then(({ data }) => {
        const rows = (data || []).map((r) => ({ id: r.id, instrument_id: r.instrument_id, quantity: r.quantity }));
        setRequirements(rows);
        setOriginalRequirementIds(rows.map((r) => r.id));
      });
    }
  }, [isEdit, gig?.id]);

  // Warn if another gig already exists on the same date (doesn't block —
  // agencies with multiple bands can genuinely have two gigs on one day).
  useEffect(() => {
    if (!gigDate) { setSameDayGigs([]); return; }
    let cancelled = false;
    supabase
      .from('gigs')
      .select('id, venues(name), bands(name)')
      .eq('gig_date', gigDate)
      .neq('status', 'cancelled')
      .then(({ data }) => {
        if (cancelled) return;
        setSameDayGigs((data || []).filter((g) => g.id !== gig?.id));
      });
    return () => { cancelled = true; };
  }, [gigDate, gig?.id]);

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
        created_by: me?.id,
      }).select().single();
            if (ve) { setError(ve.message); setSubmitting(false); return; }
      finalVenueId = nv.id;
    }



    // Quick-create client
    let finalClientId = clientId || null;
    if (showNewClient && newClientName.trim()) {
      const { data: nc, error: ce } = await supabase.from('clients').insert({
        name: newClientName, email: newClientEmail || null, phone: newClientPhone || null, created_by: me?.id,
      }).select().single();
      if (ce) { setError(ce.message); setSubmitting(false); return; }
      finalClientId = nc.id;
    }

    // Quick-create first dance song if a new title was typed instead of picked
    let finalFirstDanceSongId = firstDanceSongId || null;
    if (!finalFirstDanceSongId && firstDanceSongTitle.trim()) {
      const { data: ns, error: se } = await supabase
        .from('songs')
        .insert({ title: firstDanceSongTitle.trim(), created_by: me?.id })
        .select()
        .single();
      if (se) { setError(se.message); setSubmitting(false); return; }
      finalFirstDanceSongId = ns.id;
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
      guest_count: guestCount === '' ? null : Math.round(Number(guestCount)),
      event_type: eventType || null,
      performance_type: performanceType || null,
      mileage_rate_pence: mileageRatePence === '' ? 35 : Math.round(Number(mileageRatePence)),
      parking_notes: parkingNotes || null,
      notes: notes || null,
      sets_info: setsInfo || null,
      dress_code: (dressCodePreset === '__other__' ? dressCodeOther.trim() : dressCodePreset) || null,
      venue_wifi: venueWifi || null,
      needs_dj: needsDj,
      dj_song_rules: djSongRules || null,
      first_dance_mode: firstDanceMode || null,
      first_dance_song_id: finalFirstDanceSongId,
      needs_roadie: needsRoadie,
      roadie_stage_layout: roadieStageLayout || null,
      roadie_van_parking: roadieVanParking || null,
      roadie_contact: roadieContact || null,
      planned_headcount: plannedHeadcount === '' ? null : Math.round(Number(plannedHeadcount)),
      planned_has_captain: plannedHasCaptain,
      planned_has_singer: plannedHasSinger,
      estimated_travel_pence: estimatedTravelPounds === '' ? null : Math.round(Number(estimatedTravelPounds) * 100),
    };

    let gigId = gig?.id;
    if (isEdit) {
      const { error: ue } = await supabase.from('gigs').update(payload).eq('id', gigId);
      if (ue) { setError(ue.message); setSubmitting(false); return; }
    } else {
      const { data: ng, error: ie } = await supabase.from('gigs').insert(payload).select().single();
      if (ie) {
        // Raised by the enforce_gig_free_tier_cap_trigger DB trigger, not
        // caught client-side beforehand -- the trigger is the actual source
        // of truth for the 12-gig free limit, this just strips the
        // machine-readable prefix so the message reads cleanly.
        const message = ie.message?.startsWith('FREE_TIER_GIG_LIMIT: ')
          ? ie.message.slice('FREE_TIER_GIG_LIMIT: '.length)
          : ie.message;
        setError(message);
        setSubmitting(false);
        return;
      }
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
      const { error: re } = r.id
        ? await supabase.from('gig_requirements').update({ instrument_id: r.instrument_id, quantity: Number(r.quantity) || 1 }).eq('id', r.id)
        : await supabase.from('gig_requirements').insert({ gig_id: gigId, instrument_id: r.instrument_id, quantity: Number(r.quantity) || 1 });
      if (re) { setError(re.message); setSubmitting(false); return; }
    }

    setSubmitting(false);
    onSaved?.(gigId);
  }

  const selectedBand = bands.find((b) => b.id === bandId);
  const hasTemplate = selectedBand && [
    selectedBand.fee_split_owner_profit_pct,
    selectedBand.fee_split_singer_bonus_pct,
    selectedBand.fee_split_captain_bonus_pct,
    selectedBand.fee_split_dj_pct,
    selectedBand.fee_split_roadie_pct,
  ].some((v) => v != null);
  const previewTotalFeePence = feeAmount === '' ? 0 : Math.round(Number(feeAmount)) * 100;
  const previewHeadcount = plannedHeadcount === '' ? 0 : Math.round(Number(plannedHeadcount));
  const previewFuelPence = estimatedTravelPounds === '' ? 0 : Math.round(Number(estimatedTravelPounds) * 100);
  // A band with no fee-split percentages set isn't a blocker -- unset
  // percentages are treated as 0% by calculateFeeSplit, so the projection
  // naturally defaults to an equal split of the fee across the planned
  // headcount rather than needing someone to configure it first.
  const budgetPreview = (previewTotalFeePence > 0 && previewHeadcount > 0)
    ? calculateFeeSplit({
        totalFeePence: previewTotalFeePence,
        regularCount: previewHeadcount,
        hasSinger: plannedHasSinger,
        hasCaptain: plannedHasCaptain,
        djCount: needsDj ? 1 : 0,
        roadieCount: needsRoadie ? 1 : 0,
        fuelPence: previewFuelPence,
        template: selectedBand,
      })
    : null;

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
          <DateInput value={gigDate} onChange={(e) => setGigDate(e.target.value)} required />
          {sameDayGigs.length > 0 && (
            <span className="field__hint" style={{ color: 'var(--rust)' }}>
              ⚠ Already {sameDayGigs.length} gig{sameDayGigs.length > 1 ? 's' : ''} booked this date: {sameDayGigs.map((g) => g.venues?.name || g.bands?.name || 'Unknown venue').join(', ')}
            </span>
          )}
        </label>
        <label className="field">
          <span className="field__label">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="inquiry">Inquiry</option>
            <option value="confirmed">Confirmed</option>
            <option value="completed">Completed</option>
            {isEdit && <option value="cancelled">Cancelled</option>}
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
        <span className="field__label">
          Fee (£)
          <InfoTooltip text="Enter as a whole number, e.g. 650 rather than 650.50." />
        </span>
        <NumberInput min={0} prefix="£" value={feeAmount} onChange={(e) => setFeeAmount(e.target.value)} placeholder="e.g. 650" />
      </label>

      <label className="field">
        <span className="field__label">
          Mileage rate
          <InfoTooltip text="Pence per mile, e.g. 35 = 35p/mile. Used to calculate musician travel costs for this gig." />
        </span>
        <NumberInput min={0} suffix="p" value={mileageRatePence} onChange={(e) => setMileageRatePence(e.target.value)} placeholder="e.g. 35" />
      </label>

      <label className="field">
        <span className="field__label">Guest count (optional)</span>
        <NumberInput min={0} value={guestCount} onChange={(e) => setGuestCount(e.target.value)} placeholder="e.g. 120" />
      </label>

      <label className="field">
        <span className="field__label">Event type (optional)</span>
        <select value={eventType} onChange={(e) => setEventType(e.target.value)}>
          <option value="">Please select…</option>
          <option>Wedding</option>
          <option>Corporate event</option>
          <option>Birthday party</option>
          <option>Anniversary</option>
          <option>Festival / outdoor</option>
          <option>Private party</option>
          <option>Other</option>
        </select>
      </label>

      <label className="field">
        <span className="field__label">Performance type (optional)</span>
        <select value={performanceType} onChange={(e) => setPerformanceType(e.target.value)}>
          <option value="">Please select…</option>
          <option>Function band (on stage)</option>
          <option>Acoustic / unplugged</option>
          <option>Roaming / walkabout</option>
          <option>DJ</option>
          <option>Duo / trio</option>
          <option>Solo</option>
          <option>Other</option>
        </select>
      </label>

      <label className="field">
        <span className="field__label">Parking notes</span>
        <textarea value={parkingNotes} onChange={(e) => setParkingNotes(e.target.value)} rows={2} />
      </label>

      <label className="field">
        <span className="field__label">
          Notes
          <InfoTooltip text="e.g. dress code, greenroom, food and refreshments, bride and groom names or birthday number, favourite songs and don't play songs, stage size and style, power, load-in ground/stairs or gravel? noise limiter? wet weather plan? other acts? dj playlist? mic's for speeches/cake cutting? approx guest count, emergency day contact number? suppliers social handles?" />
        </span>
        <textarea
          placeholder="Anything else for the day sheet — see (i) for ideas"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
        />
      </label>

      <label className="field">
        <span className="field__label">Sets (optional)</span>
        <input
          value={setsInfo}
          onChange={(e) => setSetsInfo(e.target.value)}
          placeholder="e.g. 2x 60min sets"
        />
      </label>

      <label className="field">
        <span className="field__label">Dress code (optional)</span>
        <select value={dressCodePreset} onChange={(e) => setDressCodePreset(e.target.value)}>
          <option value="">— Not set —</option>
          {DRESS_CODE_PRESETS.map((p) => <option key={p} value={p}>{p}</option>)}
          <option value="__other__">Other (specify)…</option>
        </select>
        {dressCodePreset === '__other__' && (
          <textarea
            value={dressCodeOther}
            onChange={(e) => setDressCodeOther(e.target.value)}
            rows={2}
            placeholder="e.g. Freddie Mercury-style stagewear — white vest, gold armband, moustache"
            style={{ marginTop: 8 }}
          />
        )}
      </label>

      <label className="field">
        <span className="field__label">Venue wifi (optional)</span>
        <input
          value={venueWifi}
          onChange={(e) => setVenueWifi(e.target.value)}
          placeholder="e.g. routername123 - pass1234567"
        />
      </label>

      <p className="field__label" style={{ marginTop: 16, marginBottom: 8, fontWeight: 700 }}>
        Budgeting
        <InfoTooltip text="Projects the profit/loss for this gig before anyone's actually booked, using the band's fee split defaults." />
      </p>

      <div className="field-row">
        <label className="field">
          <span className="field__label">
            Planned headcount
            <InfoTooltip text="Regular musicians only — for the projection below, not the real roster. Doesn't affect who can actually be added to this gig." />
          </span>
          <NumberInput min={0} value={plannedHeadcount} onChange={(e) => setPlannedHeadcount(e.target.value)} placeholder="e.g. 4" />
        </label>
        <label className="field">
          <span className="field__label">Estimated fuel / travel (£)</span>
          <NumberInput min={0} prefix="£" value={estimatedTravelPounds} onChange={(e) => setEstimatedTravelPounds(e.target.value)} placeholder="e.g. 80" />
        </label>
      </div>

      <div className="field">
        <span className="field__label">
          Instruments needed
          <InfoTooltip text="Shows as vacancies on the roster page. DJ and roadie are toggled below, not counted here." />
        </span>
        {requirements.map((r, i) => (
          <div className="field-row requirement-row" key={r.id ?? 'new-' + i}>
            <select value={r.instrument_id} onChange={(e) => updateRequirementRow(i, 'instrument_id', e.target.value)}>
              <option value="">Choose instrument…</option>
              {instruments.map((inst) => <option key={inst.id} value={inst.id}>{inst.name}</option>)}
            </select>
            <NumberInput min={1} value={r.quantity} onChange={(e) => updateRequirementRow(i, 'quantity', e.target.value)} style={{ maxWidth: 70 }} />
            <button
              type="button"
              className="link-button link-button--danger requirement-row__remove"
              onClick={() => removeRequirementRow(i)}
              aria-label="Remove instrument requirement"
              title="Remove"
            >
              ×
            </button>
          </div>
        ))}
        <button type="button" className="btn btn--primary btn--small" style={{ marginTop: 8 }} onClick={addRequirementRow}>
          + Add instrument requirement
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '4px 0 12px' }}>
        <BudgetToggleChip label="Band captain" checked={plannedHasCaptain} onChange={setPlannedHasCaptain} />
        <BudgetToggleChip label="Lead singer" checked={plannedHasSinger} onChange={setPlannedHasSinger} />
        <BudgetToggleChip label="DJ" checked={needsDj} onChange={setNeedsDj} />
        <BudgetToggleChip label="Roadie" checked={needsRoadie} onChange={setNeedsRoadie} />
      </div>

      {!selectedBand && (
        <p className="field__hint">Pick a band above to see a profit/loss projection.</p>
      )}
      {selectedBand && !hasTemplate && (
        <p className="field__hint">This band has no custom fee split set — the projection below splits the fee equally. Set percentages on the band's edit page to change that.</p>
      )}
      {selectedBand && !budgetPreview && (
        <p className="field__hint">Enter a fee and planned headcount above to see a projection.</p>
      )}
      {budgetPreview && (
        <div className="detail-list" style={{ marginTop: 8, background: 'var(--paper-raised)', border: '1px solid var(--line)', borderRadius: 10, padding: 12 }}>
          <dt>Owner / band-leader profit</dt><dd>£{poundsFromPence(budgetPreview.ownerProfitPence)} — band pot, not paid to a musician</dd>
          {plannedHasCaptain && <><dt>Captain bonus</dt><dd>+£{poundsFromPence(budgetPreview.captainBonusPence)}</dd></>}
          {plannedHasSinger && <><dt>Singer bonus</dt><dd>+£{poundsFromPence(budgetPreview.singerBonusPence)}</dd></>}
          {needsDj && <><dt>DJ</dt><dd>£{poundsFromPence(budgetPreview.djFeePence)}</dd></>}
          {needsRoadie && <><dt>Roadie</dt><dd>£{poundsFromPence(budgetPreview.roadieFeePence)}</dd></>}
          <dt>Estimated fuel</dt><dd>£{poundsFromPence(previewFuelPence)}</dd>
          <dt>Per musician (÷{previewHeadcount})</dt>
          <dd>
            <strong style={{ color: budgetPreview.perMusicianBasePence < 0 ? 'var(--rust)' : 'inherit' }}>
              £{poundsFromPence(budgetPreview.perMusicianBasePence)} each
            </strong>
            {budgetPreview.perMusicianBasePence < 0 && ' — this gig loses money at this fee'}
          </dd>
        </div>
      )}
      {budgetPreview?.belowDjOrRoadie && (
        <p className="form-error">
          ⚠ At this fee and headcount, each musician would earn less than the DJ/roadie flat rate — consider raising the fee or booking fewer musicians.
        </p>
      )}

      <p className="field__label" style={{ marginTop: 16, marginBottom: 8, fontWeight: 700 }}>
        DJ details (optional)
        <InfoTooltip text="Toggle 'DJ' in the Budgeting chips above to include the DJ fee in the projection — these fields just capture the details once you have." />
      </p>

      <label className="field">
        <span className="field__label">Do / don't play songs</span>
        <textarea
          value={djSongRules}
          onChange={(e) => setDjSongRules(e.target.value)}
          rows={2}
          placeholder="e.g. Don't play: Come On Eileen. Must play: Mr Brightside."
        />
      </label>

      <label className="field">
        <span className="field__label">First dance</span>
        <select value={firstDanceMode} onChange={(e) => setFirstDanceMode(e.target.value)}>
          <option value="">Not applicable</option>
          <option value="live">Live band</option>
          <option value="dj">DJ / playlist</option>
        </select>
      </label>

      {firstDanceMode && (
        <label className="field">
          <span className="field__label">First dance song</span>
          <select
            value={firstDanceSongId}
            onChange={(e) => { setFirstDanceSongId(e.target.value); setFirstDanceSongTitle(''); }}
          >
            <option value="">Pick an existing song…</option>
            {songs.map((s) => (
              <option key={s.id} value={s.id}>{s.title}{s.artist ? ' — ' + s.artist : ''}</option>
            ))}
          </select>
          <span className="field__hint">or</span>
          <input
            placeholder="Type a new song title"
            value={firstDanceSongTitle}
            onChange={(e) => { setFirstDanceSongTitle(e.target.value); setFirstDanceSongId(''); }}
          />
        </label>
      )}

      <p className="field__label" style={{ marginTop: 16, marginBottom: 8, fontWeight: 700 }}>
        Roadie details (optional)
        <InfoTooltip text="Toggle 'Roadie' in the Budgeting chips above to include the roadie fee in the projection — these fields just capture the details once you have." />
      </p>

      <label className="field">
        <span className="field__label">Stage layout</span>
        <textarea value={roadieStageLayout} onChange={(e) => setRoadieStageLayout(e.target.value)} rows={2} />
      </label>

      <label className="field">
        <span className="field__label">Van parking</span>
        <textarea value={roadieVanParking} onChange={(e) => setRoadieVanParking(e.target.value)} rows={2} />
      </label>

      <label className="field">
        <span className="field__label">First point of contact on site</span>
        <input
          value={roadieContact}
          onChange={(e) => setRoadieContact(e.target.value)}
          placeholder="e.g. Dave, venue duty manager, 07700 900123"
        />
      </label>

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
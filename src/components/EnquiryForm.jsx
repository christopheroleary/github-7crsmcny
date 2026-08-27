import { useState } from 'react';
import { supabase } from '../supabaseClient';
import AddressAutocomplete from './AddressAutocomplete.jsx';
import DateInput from './DateInput.jsx';
import NumberInput from './NumberInput.jsx';

// Mirrors the CHECK constraints in 20260826120000_validate_enquiries.sql.
// These exist for the person filling the form in -- a maxLength they bump
// into beats a rejected submission after they've typed three paragraphs.
// The database is the actual boundary; this form isn't, since anyone can
// POST straight at the API.
const LIMITS = {
  name: 100,
  email: 200,
  phone: 40,
  venueName: 200,
  venueAddress: 300,
  requirements: 2000,
};

export default function EnquiryForm({ bandId = null, embedded = false }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [eventType, setEventType] = useState('');
  const [venueName, setVenueName] = useState('');
  const [venueAddress, setVenueAddress] = useState('');
  const [budget, setBudget] = useState('');
  const [bandSize, setBandSize] = useState('');
  const [requirements, setRequirements] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    // Trim everything before validating: a name of pure spaces passes
    // `required` in the browser but fails the constraint server-side, and
    // a trailing newline in the address is just noise on the day sheet.
    const trimmed = {
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      venueName: venueName.trim(),
      venueAddress: venueAddress.trim(),
      requirements: requirements.trim(),
    };

    if (!trimmed.name) { setError('Please tell us your name.'); return; }
    if (trimmed.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed.email)) {
      setError('That email address doesn\'t look right — please check it.');
      return;
    }
    const budgetNum = budget ? Math.round(Number(budget)) : null;
    if (budgetNum != null && (!Number.isFinite(budgetNum) || budgetNum < 0)) {
      setError('Please enter a budget as a number, or leave it blank.');
      return;
    }

    setSubmitting(true);
    const { error } = await supabase.from('enquiries').insert({
      client_name: trimmed.name,
      client_email: trimmed.email || null,
      client_phone: trimmed.phone || null,
      event_date: eventDate || null,
      event_type: eventType || null,
      venue_name: trimmed.venueName || null,
      venue_address: trimmed.venueAddress || null,
      estimated_budget: budgetNum,
      band_size: bandSize || null,
      requirements: trimmed.requirements || null,
      band_id: bandId,
    });

    setSubmitting(false);
    if (error) {
      // A constraint rejection means something in the form is out of range,
      // which is worth saying plainly -- the old blanket "something went
      // wrong" left people retrying an identical submission forever.
      setError(
        error.message?.includes('violates check constraint')
          ? 'Something in the form is too long or not quite right — please check your details and try again.'
          : 'Something went wrong — please try again or contact us directly.'
      );
      return;
    }
    setSubmitted(true);
  }

  if (submitted) {
    const success = (
      <div className="enquiry-success">
        <div className="enquiry-success__icon">🎸</div>
        <h1>Enquiry received!</h1>
        <p>Thanks {name.split(' ')[0]}, we'll be in touch shortly to discuss your event.</p>
      </div>
    );
    return embedded ? success : <div className="enquiry-page">{success}</div>;
  }

  const card = (
      <div className="enquiry-card">
        <div className="enquiry-card__header">
          <h1 className="enquiry-card__title">Book us for your event</h1>
          <p className="enquiry-card__sub">Fill in your details and we'll get back to you with availability and pricing.</p>
        </div>

        <form onSubmit={handleSubmit}>
          <p className="enquiry-section-label">Your details</p>

          <label className="field">
            <span className="field__label">Your name *</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={LIMITS.name} placeholder="Jane Smith" />
          </label>

          <div className="field-row">
            <label className="field">
              <span className="field__label">Email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={LIMITS.email} placeholder="jane@example.com" />
            </label>
            <label className="field">
              <span className="field__label">Phone</span>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={LIMITS.phone} placeholder="07700 900123" />
            </label>
          </div>

          <p className="enquiry-section-label">Event details</p>

          <div className="field-row">
            <label className="field">
              <span className="field__label">Event date</span>
              <DateInput value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
            </label>
            <label className="field">
              <span className="field__label">Event type</span>
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
          </div>

          <label className="field">
            <span className="field__label">Venue name</span>
            <input value={venueName} onChange={(e) => setVenueName(e.target.value)} maxLength={LIMITS.venueName} placeholder="The Grand Hotel" />
          </label>

          <label className="field">
            <span className="field__label">Venue address</span>
            <AddressAutocomplete
              value={venueAddress}
              // Autocomplete can hand back a long formatted address, and a
              // free-typed one is unbounded, so clamp here rather than
              // letting it fail the constraint on submit.
              onChange={(v) => setVenueAddress((v || '').slice(0, LIMITS.venueAddress))}
              placeholder="Start typing the venue address…"
            />
          </label>

          <div className="field-row">
            <label className="field">
              <span className="field__label">Estimated budget (£)</span>
              <NumberInput min={0} prefix="£" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="e.g. 1500" />
            </label>
            <label className="field">
              <span className="field__label">Band size preference</span>
              <select value={bandSize} onChange={(e) => setBandSize(e.target.value)}>
                <option value="">No preference</option>
                <option>Solo / duo</option>
                <option>3 piece</option>
                <option>4 piece</option>
                <option>5 piece</option>
                <option>6+ piece</option>
              </select>
            </label>
          </div>

          <label className="field">
            <span className="field__label">Any special requirements?</span>
            <textarea
              value={requirements}
              onChange={(e) => setRequirements(e.target.value)}
              rows={4}
              maxLength={LIMITS.requirements}
              placeholder="First dance song, special requests, access requirements, etc."
            />
            {/* Only appears once they're near the cap -- a counter on an
                empty box just makes the form look bureaucratic. */}
            {requirements.length > LIMITS.requirements * 0.8 && (
              <span className="field__hint">
                {LIMITS.requirements - requirements.length} characters left
              </span>
            )}
          </label>

          <div className="field" style={{ background: 'var(--paper-raised)', border: '1px solid var(--line)', borderRadius: 10, padding: 12, margin: '16px 0 0' }}>
            <span className="field__label">Your privacy</span>
            <p className="field__hint" style={{ margin: 0 }}>
              We'll use this to check availability and quote for your event — nothing else. Only the
              band and its admin see it; the venue address box also briefly checks OpenStreetMap as
              you type. We keep it while we're in touch, then delete it — just ask if you'd like to
              see, change or delete what we've got.
            </p>
          </div>

          {error && <p className="form-error">{error}</p>}

          <button type="submit" className="btn btn--primary" style={{ width: '100%', marginTop: 8 }} disabled={submitting}>
            {submitting ? 'Sending…' : 'Send enquiry'}
          </button>
        </form>
      </div>
  );

  return embedded ? card : <div className="enquiry-page">{card}</div>;
}
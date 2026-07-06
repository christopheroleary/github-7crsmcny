import { useState } from 'react';
import { supabase } from '../supabaseClient';
import AddressAutocomplete from './AddressAutocomplete.jsx';

export default function EnquiryForm() {
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
    setSubmitting(true);
    setError(null);

    const { error } = await supabase.from('enquiries').insert({
      client_name: name,
      client_email: email || null,
      client_phone: phone || null,
      event_date: eventDate || null,
      event_type: eventType || null,
      venue_name: venueName || null,
      venue_address: venueAddress || null,
      estimated_budget: budget ? Math.round(Number(budget)) : null,
      band_size: bandSize || null,
      requirements: requirements || null,
    });

    setSubmitting(false);
    if (error) { setError('Something went wrong — please try again or contact us directly.'); return; }
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="enquiry-page">
        <div className="enquiry-success">
          <div className="enquiry-success__icon">🎸</div>
          <h1>Enquiry received!</h1>
          <p>Thanks {name.split(' ')[0]}, we'll be in touch shortly to discuss your event.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="enquiry-page">
      <div className="enquiry-card">
        <div className="enquiry-card__header">
          <h1 className="enquiry-card__title">Book us for your event</h1>
          <p className="enquiry-card__sub">Fill in your details and we'll get back to you with availability and pricing.</p>
        </div>

        <form onSubmit={handleSubmit}>
          <p className="enquiry-section-label">Your details</p>

          <label className="field">
            <span className="field__label">Your name *</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Jane Smith" />
          </label>

          <div className="field-row">
            <label className="field">
              <span className="field__label">Email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@example.com" />
            </label>
            <label className="field">
              <span className="field__label">Phone</span>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07700 900123" />
            </label>
          </div>

          <p className="enquiry-section-label">Event details</p>

          <div className="field-row">
            <label className="field">
              <span className="field__label">Event date</span>
              <input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
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
            <input value={venueName} onChange={(e) => setVenueName(e.target.value)} placeholder="The Grand Hotel" />
          </label>

          <label className="field">
            <span className="field__label">Venue address</span>
            <AddressAutocomplete
              value={venueAddress}
              onChange={setVenueAddress}
              placeholder="Start typing the venue address…"
            />
          </label>

          <div className="field-row">
            <label className="field">
              <span className="field__label">Estimated budget (£)</span>
              <input
                type="number"
                min="0"
                step="50"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                placeholder="e.g. 1500"
              />
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
              placeholder="First dance song, special requests, access requirements, etc."
            />
          </label>

          {error && <p className="form-error">{error}</p>}

          <button type="submit" className="btn btn--primary" style={{ width: '100%', marginTop: 8 }} disabled={submitting}>
            {submitting ? 'Sending…' : 'Send enquiry'}
          </button>
        </form>
      </div>
    </div>
  );
}
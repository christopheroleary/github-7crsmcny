import { useState } from 'react';
import { supabase } from '../supabaseClient';
import { useCurrentProfile } from '../context/ProfileContext.jsx';
import AddressAutocomplete from './AddressAutocomplete.jsx';

export default function VenueForm({ venue, onSaved, onCancel }) {
  const { profile: me } = useCurrentProfile();
  const isEdit = Boolean(venue);
  const [name, setName] = useState(venue?.name || '');
  const [address, setAddress] = useState(venue?.address || '');
  const [latitude, setLatitude] = useState(venue?.latitude ?? null);
  const [longitude, setLongitude] = useState(venue?.longitude ?? null);
  const [contactName, setContactName] = useState(venue?.contact_name || '');
  const [contactTitle, setContactTitle] = useState(venue?.contact_title || '');
  const [phone, setPhone] = useState(venue?.phone || '');
  const [email, setEmail] = useState(venue?.email || '');
  const [website, setWebsite] = useState(venue?.website || '');
  const [loadInNotes, setLoadInNotes] = useState(venue?.load_in_notes || '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const payload = {
      name,
      address: address || null,
      latitude,
      longitude,
      contact_name: contactName || null,
      contact_title: contactTitle || null,
      phone: phone || null,
      email: email || null,
      website: website || null,
      load_in_notes: loadInNotes || null,
    };

    const { error } = isEdit
      ? await supabase.from('venues').update(payload).eq('id', venue.id)
      : await supabase.from('venues').insert({ ...payload, created_by: me?.id });

    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    onSaved?.();
  }

  // OpenStreetMap/Photon (used above for address autocomplete) don't
  // reliably carry phone/website for the kind of small, often-private
  // venues this app deals with -- that data mostly lives in each venue's
  // Google Business Profile instead, so this just jumps straight to a
  // pre-filled search rather than trying to auto-fetch it.
  const lookupHref = name.trim()
    ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(name + (address ? ', ' + address : ''))
    : null;

  return (
    <form className="entity-form" onSubmit={handleSubmit}>
      <label className="field">
        <span className="field__label">Venue name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>

      <label className="field">
        <span className="field__label">Address</span>
        <AddressAutocomplete
          value={address}
          onChange={(text) => {
            setAddress(text);
            setLatitude(null);
            setLongitude(null);
          }}
          onCoordinatesChange={(lat, lon) => {
            setLatitude(lat);
            setLongitude(lon);
          }}
          placeholder="Start typing an address…"
        />
        {latitude != null && <p className="address-autocomplete__credit">Map location set ✓</p>}
      </label>

      {lookupHref && (
        <p className="field__hint" style={{ marginTop: -8, marginBottom: 16 }}>
          <button
            type="button"
            className="link-button"
            style={{ display: 'inline', padding: 0, fontSize: 'inherit' }}
            onClick={() => window.open(lookupHref, '_blank', 'noopener,noreferrer')}
          >
            Find on Google Maps ↗
          </button>
          {' '}— useful for finding this venue's phone number or website to fill in below.
        </p>
      )}

      <div className="field-row">
        <label className="field">
          <span className="field__label">Contact name</span>
          <input value={contactName} onChange={(e) => setContactName(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Contact job title</span>
          <input value={contactTitle} onChange={(e) => setContactTitle(e.target.value)} placeholder="e.g. Events Manager" />
        </label>
      </div>

      <div className="field-row">
        <label className="field">
          <span className="field__label">Phone</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
      </div>

      <label className="field">
        <span className="field__label">Website</span>
        <input type="url" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" />
      </label>

      <label className="field">
        <span className="field__label">Load-in notes</span>
        <textarea value={loadInNotes} onChange={(e) => setLoadInNotes(e.target.value)} rows={3} />
      </label>

      {error && <p className="form-error">{error}</p>}

      <div className="form-actions">
        <button type="button" className="btn btn--ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn--primary" disabled={submitting}>
          {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Save venue'}
        </button>
      </div>
    </form>
  );
}
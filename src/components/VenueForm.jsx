import { useState } from 'react';
import { supabase } from '../supabaseClient';
import AddressAutocomplete from './AddressAutocomplete.jsx';

export default function VenueForm({ venue, onSaved, onCancel }) {
  const isEdit = Boolean(venue);
  const [name, setName] = useState(venue?.name || '');
  const [address, setAddress] = useState(venue?.address || '');
  const [contactName, setContactName] = useState(venue?.contact_name || '');
  const [phone, setPhone] = useState(venue?.phone || '');
  const [email, setEmail] = useState(venue?.email || '');
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
      contact_name: contactName || null,
      phone: phone || null,
      email: email || null,
      load_in_notes: loadInNotes || null,
    };

    const { error } = isEdit
      ? await supabase.from('venues').update(payload).eq('id', venue.id)
      : await supabase.from('venues').insert(payload);

    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    onSaved?.();
  }

  return (
    <form className="entity-form" onSubmit={handleSubmit}>
      <label className="field">
        <span className="field__label">Venue name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>

      <label className="field">
        <span className="field__label">Address</span>
        <AddressAutocomplete value={address} onChange={setAddress} placeholder="Start typing an address…" />
      </label>

      <div className="field-row">
        <label className="field">
          <span className="field__label">Contact name</span>
          <input value={contactName} onChange={(e) => setContactName(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Phone</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
      </div>

      <label className="field">
        <span className="field__label">Email</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
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
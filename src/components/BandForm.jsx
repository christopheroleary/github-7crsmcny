import { useState } from 'react';
import { supabase } from '../supabaseClient';

export default function BandForm({ band, onSaved, onCancel }) {
  const isEdit = Boolean(band);
  const [name, setName] = useState(band?.name || '');
  const [notes, setNotes] = useState(band?.notes || '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const payload = { name, notes: notes || null };
    const { error } = isEdit
      ? await supabase.from('bands').update(payload).eq('id', band.id)
      : await supabase.from('bands').insert(payload);

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
        <span className="field__label">Band name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>

      <label className="field">
        <span className="field__label">Notes</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </label>

      {error && <p className="form-error">{error}</p>}

      <div className="form-actions">
        <button type="button" className="btn btn--ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn--primary" disabled={submitting}>
          {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Save band'}
        </button>
      </div>
    </form>
  );
}
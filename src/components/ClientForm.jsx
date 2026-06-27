import { useState } from 'react';
import { supabase } from '../supabaseClient';

export default function ClientForm({ client, onSaved, onCancel }) {
  const isEdit = Boolean(client);
  const [name, setName] = useState(client?.name || '');
  const [email, setEmail] = useState(client?.email || '');
  const [phone, setPhone] = useState(client?.phone || '');
  const [billingNotes, setBillingNotes] = useState(client?.billing_notes || '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const payload = { name, email: email || null, phone: phone || null, billing_notes: billingNotes || null };

    const { error } = isEdit
      ? await supabase.from('clients').update(payload).eq('id', client.id)
      : await supabase.from('clients').insert(payload);

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
        <span className="field__label">Client name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>

      <div className="field-row">
        <label className="field">
          <span className="field__label">Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Phone</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
      </div>

      <label className="field">
        <span className="field__label">Billing notes</span>
        <textarea value={billingNotes} onChange={(e) => setBillingNotes(e.target.value)} rows={3} />
      </label>

      {error && <p className="form-error">{error}</p>}

      <div className="form-actions">
        <button type="button" className="btn btn--ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn--primary" disabled={submitting}>
          {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Save client'}
        </button>
      </div>
    </form>
  );
}
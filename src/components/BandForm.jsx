import { useState } from 'react';
import { supabase } from '../supabaseClient';

export default function BandForm({ band, onSaved, onCancel }) {
  const isEdit = Boolean(band);
  const [name, setName] = useState(band?.name || '');
  const [notes, setNotes] = useState(band?.notes || '');
  const [contactEmail, setContactEmail] = useState(band?.contact_email || '');
  const [contactPhone, setContactPhone] = useState(band?.contact_phone || '');
  const [address, setAddress] = useState(band?.address || '');
  const [bankName, setBankName] = useState(band?.bank_name || '');
  const [bankAccountName, setBankAccountName] = useState(band?.bank_account_name || '');
  const [bankSortCode, setBankSortCode] = useState(band?.bank_sort_code || '');
  const [bankAccountNumber, setBankAccountNumber] = useState(band?.bank_account_number || '');
  const [vatNumber, setVatNumber] = useState(band?.vat_number || '');
  const [invoiceNotes, setInvoiceNotes] = useState(band?.invoice_notes || '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const payload = {
      name,
      notes: notes || null,
      contact_email: contactEmail || null,
      contact_phone: contactPhone || null,
      address: address || null,
      bank_name: bankName || null,
      bank_account_name: bankAccountName || null,
      bank_sort_code: bankSortCode || null,
      bank_account_number: bankAccountNumber || null,
      vat_number: vatNumber || null,
      invoice_notes: invoiceNotes || null,
    };

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
        <span className="field__label">Band / agency name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>

      <label className="field">
        <span className="field__label">Notes</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </label>

      <p className="field__label" style={{ marginTop: 16, marginBottom: 8, fontWeight: 700 }}>Contact details (shown on invoices)</p>

      <div className="field-row">
        <label className="field">
          <span className="field__label">Email</span>
          <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Phone</span>
          <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
        </label>
      </div>

      <label className="field">
        <span className="field__label">Address</span>
        <textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} placeholder="Your trading address as it should appear on invoices" />
      </label>

      <label className="field">
        <span className="field__label">VAT number (optional)</span>
        <input value={vatNumber} onChange={(e) => setVatNumber(e.target.value)} placeholder="e.g. GB123456789" />
      </label>

      <p className="field__label" style={{ marginTop: 16, marginBottom: 8, fontWeight: 700 }}>Bank details (shown on invoices for payment)</p>

      <div className="field-row">
        <label className="field">
          <span className="field__label">Bank name</span>
          <input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="e.g. Barclays" />
        </label>
        <label className="field">
          <span className="field__label">Account name</span>
          <input value={bankAccountName} onChange={(e) => setBankAccountName(e.target.value)} />
        </label>
      </div>

      <div className="field-row">
        <label className="field">
          <span className="field__label">Sort code</span>
          <input value={bankSortCode} onChange={(e) => setBankSortCode(e.target.value)} placeholder="XX-XX-XX" />
        </label>
        <label className="field">
          <span className="field__label">Account number</span>
          <input value={bankAccountNumber} onChange={(e) => setBankAccountNumber(e.target.value)} placeholder="XXXXXXXX" />
        </label>
      </div>

      <label className="field">
        <span className="field__label">Default invoice footer / payment terms</span>
        <textarea
          value={invoiceNotes}
          onChange={(e) => setInvoiceNotes(e.target.value)}
          rows={3}
          placeholder="e.g. Payment is due within 14 days of the invoice date. Thank you for your booking."
        />
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
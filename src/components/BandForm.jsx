import { useState } from 'react';
import { supabase } from '../supabaseClient';

export default function BandForm({ band, onSaved, onCancel }) {
  const isEdit = Boolean(band);
  const [name, setName] = useState(band?.name || '');
  const [invoiceName, setInvoiceName] = useState(band?.invoice_name || '');
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
  const [musicianBasePct, setMusicianBasePct] = useState(band?.fee_split_musician_base_pct ?? '');
  const [singerBonusPct, setSingerBonusPct] = useState(band?.fee_split_singer_bonus_pct ?? '');
  const [captainBonusPct, setCaptainBonusPct] = useState(band?.fee_split_captain_bonus_pct ?? '');
  const [djPct, setDjPct] = useState(band?.fee_split_dj_pct ?? '');
  const [roadiePct, setRoadiePct] = useState(band?.fee_split_roadie_pct ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const payload = {
      name,
      invoice_name: invoiceName || null,
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
      fee_split_musician_base_pct: musicianBasePct === '' ? null : Number(musicianBasePct),
      fee_split_singer_bonus_pct: singerBonusPct === '' ? null : Number(singerBonusPct),
      fee_split_captain_bonus_pct: captainBonusPct === '' ? null : Number(captainBonusPct),
      fee_split_dj_pct: djPct === '' ? null : Number(djPct),
      fee_split_roadie_pct: roadiePct === '' ? null : Number(roadiePct),
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
        <span className="field__label">Official invoice name (optional)</span>
        <input
          value={invoiceName}
          onChange={(e) => setInvoiceName(e.target.value)}
          placeholder="e.g. Chip Shop Boys Entertainment Ltd"
        />
        <span className="field__hint">Used on invoices and musician claims instead of the band name above, if set.</span>
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

      <p className="field__label" style={{ marginTop: 16, marginBottom: 8, fontWeight: 700 }}>Fee split defaults (optional)</p>
      <p className="field__hint" style={{ marginBottom: 8 }}>
        Each role's cut as a % of the total gig fee — used to suggest a per-musician split when budgeting a gig for this band.
        Leave any of these blank if the band doesn't use that role. Whoever is band captain receives whatever's left over after
        everyone else and travel costs are paid, so their bonus below is added on top of that remainder, not instead of it.
      </p>

      <div className="field-row">
        <label className="field">
          <span className="field__label">Musician base (%)</span>
          <input type="number" min="0" max="100" step="0.1" value={musicianBasePct} onChange={(e) => setMusicianBasePct(e.target.value)} placeholder="e.g. 12.8" />
        </label>
        <label className="field">
          <span className="field__label">Singer bonus (%)</span>
          <input type="number" min="0" max="100" step="0.1" value={singerBonusPct} onChange={(e) => setSingerBonusPct(e.target.value)} placeholder="e.g. 2.5" />
        </label>
      </div>

      <div className="field-row">
        <label className="field">
          <span className="field__label">Captain bonus (%)</span>
          <input type="number" min="0" max="100" step="0.1" value={captainBonusPct} onChange={(e) => setCaptainBonusPct(e.target.value)} placeholder="e.g. 2.5" />
        </label>
        <label className="field">
          <span className="field__label">DJ (%)</span>
          <input type="number" min="0" max="100" step="0.1" value={djPct} onChange={(e) => setDjPct(e.target.value)} placeholder="e.g. 7.5" />
        </label>
        <label className="field">
          <span className="field__label">Roadie (%)</span>
          <input type="number" min="0" max="100" step="0.1" value={roadiePct} onChange={(e) => setRoadiePct(e.target.value)} placeholder="e.g. 7.5" />
        </label>
      </div>

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
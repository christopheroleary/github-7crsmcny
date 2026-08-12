import { useState } from 'react';
import { supabase } from '../supabaseClient';
import { useCurrentProfile } from '../context/ProfileContext.jsx';

// Common wedding/event vendor types -- deliberately not a DB check
// constraint (same convention as GigForm's dress-code presets) so this
// list can grow without a migration, and an "Other" pick still lands as
// plain readable text in the one `category` column rather than a second
// nullable column that's empty 95% of the time.
export const SUPPLIER_CATEGORY_PRESETS = [
  'Photographer',
  'Videographer',
  'Florist',
  'Marquee / tent hire',
  'DJ',
  'PA hire / sound & lighting',
  'Staging',
  'Games / entertainment',
  'Event planner',
  'MC / toastmaster',
  'Caterer',
  'Bar hire',
  'Cars / transport',
];

export default function SupplierForm({ supplier, onSaved, onCancel }) {
  const { profile: me } = useCurrentProfile();
  const isEdit = Boolean(supplier);
  const [categoryPreset, setCategoryPreset] = useState(
    supplier?.category ? (SUPPLIER_CATEGORY_PRESETS.includes(supplier.category) ? supplier.category : '__other__') : ''
  );
  const [categoryOther, setCategoryOther] = useState(
    supplier?.category && !SUPPLIER_CATEGORY_PRESETS.includes(supplier.category) ? supplier.category : ''
  );
  const [companyName, setCompanyName] = useState(supplier?.company_name || '');
  const [ownerName, setOwnerName] = useState(supplier?.owner_name || '');
  const [contactEmail, setContactEmail] = useState(supplier?.contact_email || '');
  const [contactPhone, setContactPhone] = useState(supplier?.contact_phone || '');
  const [socialUrl, setSocialUrl] = useState(supplier?.social_url || '');
  const [notes, setNotes] = useState(supplier?.notes || '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    const category = (categoryPreset === '__other__' ? categoryOther.trim() : categoryPreset) || '';
    if (!category) {
      setError('Choose a service category, or specify one under "Other".');
      return;
    }

    setSubmitting(true);
    const payload = {
      category,
      company_name: companyName.trim(),
      owner_name: ownerName.trim() || null,
      contact_email: contactEmail.trim() || null,
      contact_phone: contactPhone.trim() || null,
      social_url: socialUrl.trim() || null,
      notes: notes.trim() || null,
    };

    const { data: saved, error: saveError } = isEdit
      ? await supabase.from('suppliers').update(payload).eq('id', supplier.id).select().single()
      : await supabase.from('suppliers').insert({ ...payload, created_by: me?.id }).select().single();

    setSubmitting(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    onSaved?.(saved);
  }

  return (
    <form className="entity-form" onSubmit={handleSubmit}>
      <label className="field">
        <span className="field__label">Service</span>
        <select value={categoryPreset} onChange={(e) => setCategoryPreset(e.target.value)} required>
          <option value="">Please select…</option>
          {SUPPLIER_CATEGORY_PRESETS.map((c) => <option key={c} value={c}>{c}</option>)}
          <option value="__other__">Other (specify)…</option>
        </select>
        {categoryPreset === '__other__' && (
          <input
            value={categoryOther}
            onChange={(e) => setCategoryOther(e.target.value)}
            placeholder="e.g. Fireworks display"
            maxLength={60}
            style={{ marginTop: 8 }}
            required
          />
        )}
      </label>

      <label className="field">
        <span className="field__label">Company name</span>
        <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} required />
      </label>

      <label className="field">
        <span className="field__label">Owner name</span>
        <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
      </label>

      <div className="field-row">
        <label className="field">
          <span className="field__label">Phone</span>
          <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Email</span>
          <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
        </label>
      </div>

      <label className="field">
        <span className="field__label">Social media / website</span>
        <input
          value={socialUrl}
          onChange={(e) => setSocialUrl(e.target.value)}
          placeholder="e.g. instagram.com/theirhandle"
        />
        <span className="field__hint">So band members know who to tag when posting photos.</span>
      </label>

      <label className="field">
        <span className="field__label">Notes (optional)</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="e.g. Great in bad weather, brings own PA, easy to work with"
        />
      </label>

      {error && <p className="form-error">{error}</p>}

      <div className="form-actions">
        <button type="button" className="btn btn--ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn--primary" disabled={submitting}>
          {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Save supplier'}
        </button>
      </div>
    </form>
  );
}

import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

function formatSortCode(raw) {
  // normalise to 00-00-00 display
  const digits = raw.replace(/\D/g, '').slice(0, 6);
  return digits.replace(/(\d{2})(?=\d)/g, '$1-');
}

export default function ProfilePaymentDetails({ profileId }) {
  const [loading, setLoading]   = useState(true);
  const [editing, setEditing]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState(null);
  const [success, setSuccess]   = useState(false);

  // stored values
  const [stored, setStored] = useState({
    bank_name: '',
    bank_account_name: '',
    bank_sort_code: '',
    bank_account_number: '',
  });

  // draft values while editing
  const [draft, setDraft] = useState({ ...stored });

  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data } = await supabase
        .from('profiles')
        .select('bank_name, bank_account_name, bank_sort_code, bank_account_number')
        .eq('id', profileId)
        .maybeSingle();

      if (data) {
        const vals = {
          bank_name:           data.bank_name           || '',
          bank_account_name:   data.bank_account_name   || '',
          bank_sort_code:      data.bank_sort_code       || '',
          bank_account_number: data.bank_account_number || '',
        };
        setStored(vals);
        setDraft(vals);
      }
      setLoading(false);
    }
    load();
  }, [profileId]);

  function startEdit() {
    setDraft({ ...stored });
    setError(null);
    setSuccess(false);
    setEditing(true);
  }

  function handleChange(e) {
    const { name, value } = e.target;
    setDraft(prev => ({ ...prev, [name]: value }));
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);

    const payload = {
      bank_name:           draft.bank_name.trim()           || null,
      bank_account_name:   draft.bank_account_name.trim()   || null,
      bank_sort_code:      draft.bank_sort_code.replace(/\D/g, '') || null,
      bank_account_number: draft.bank_account_number.trim() || null,
    };

    const { error: saveError } = await supabase
      .from('profiles')
      .update(payload)
      .eq('id', profileId);

    setSaving(false);

    if (saveError) {
      setError(saveError.message);
      return;
    }

    // persist normalised values back to stored/draft
    setStored({
      bank_name:           payload.bank_name           || '',
      bank_account_name:   payload.bank_account_name   || '',
      bank_sort_code:      payload.bank_sort_code       || '',
      bank_account_number: payload.bank_account_number || '',
    });
    setEditing(false);
    setSuccess(true);
  }

  if (loading) return null;

  const hasDetails = stored.bank_account_name || stored.bank_account_number;

  return (
    <div className="day-sheet__section">
      <h3 className="day-sheet__section-title">Payment details</h3>
      <p className="field__hint" style={{ marginBottom: 12 }}>
        These details appear on your payment claim invoices so the band knows where
        to send your fee. They are only visible to you and admins.
      </p>

      {!editing && (
        <>
          {hasDetails ? (
            <dl className="detail-list">
              {stored.bank_name && (
                <>
                  <dt className="detail-list__label">Bank</dt>
                  <dd className="detail-list__value">{stored.bank_name}</dd>
                </>
              )}
              <dt className="detail-list__label">Account name</dt>
              <dd className="detail-list__value">{stored.bank_account_name || '—'}</dd>
              <dt className="detail-list__label">Sort code</dt>
              <dd className="detail-list__value">
                {stored.bank_sort_code
                  ? formatSortCode(stored.bank_sort_code)
                  : '—'}
              </dd>
              <dt className="detail-list__label">Account number</dt>
              <dd className="detail-list__value">
                {stored.bank_account_number
                  ? '•••• ' + stored.bank_account_number.slice(-4)
                  : '—'}
              </dd>
            </dl>
          ) : (
            <p className="field__hint">No payment details added yet.</p>
          )}

          {success && (
            <p className="form-success" style={{ marginTop: 8 }}>
              Payment details saved.
            </p>
          )}

          <button
            className="btn btn--ghost btn--small"
            style={{ marginTop: 10 }}
            onClick={startEdit}
          >
            {hasDetails ? 'Edit payment details' : 'Add payment details'}
          </button>
        </>
      )}

      {editing && (
        <form className="inline-subform" onSubmit={handleSave}>
          <label className="field">
            <span className="field__label">Bank name <span className="field__optional">(optional)</span></span>
            <input
              name="bank_name"
              value={draft.bank_name}
              onChange={handleChange}
              placeholder="e.g. Monzo, Barclays"
              autoComplete="off"
            />
          </label>

          <label className="field">
            <span className="field__label">Account name</span>
            <input
              name="bank_account_name"
              value={draft.bank_account_name}
              onChange={handleChange}
              placeholder="Name on the account"
              autoComplete="off"
              required
            />
          </label>

          <label className="field">
            <span className="field__label">Sort code</span>
            <input
              name="bank_sort_code"
              value={draft.bank_sort_code}
              onChange={handleChange}
              placeholder="00-00-00"
              maxLength={8}
              autoComplete="off"
              inputMode="numeric"
            />
          </label>

          <label className="field">
            <span className="field__label">Account number</span>
            <input
              name="bank_account_number"
              value={draft.bank_account_number}
              onChange={handleChange}
              placeholder="12345678"
              maxLength={8}
              autoComplete="off"
              inputMode="numeric"
            />
          </label>

          {error && <p className="form-error">{error}</p>}

          <div className="form-actions">
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn--primary btn--small"
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save payment details'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
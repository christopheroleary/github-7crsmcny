import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useCurrentProfile } from '../context/ProfileContext.jsx';
import ContractPrintModal from './ContractPrintModal.jsx';
import { confirmAsync } from '../utils/confirmService.js';

function poundsFromPence(pence) {
  return (pence / 100).toFixed(2);
}

export default function GigContract({ gigId, gigFeeAmount }) {
  const { isAdmin: isAdminRole, isBandLeader } = useCurrentProfile();
  const isAdmin = isAdminRole || isBandLeader;
  const [contract, setContract] = useState(null);
  const [gig, setGig] = useState(null);
  const [band, setBand] = useState(null);
  const [client, setClient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [showPrint, setShowPrint] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);

    const { data: gigData } = await supabase
      .from('gigs')
      .select('*, venues(name, address), clients(*), bands(*)')
      .eq('id', gigId)
      .single();

    setGig(gigData);
    setClient(gigData?.clients || null);
    setBand(gigData?.bands || null);

    const { data: contractData } = await supabase
      .from('contracts')
      .select('*')
      .eq('gig_id', gigId)
      .maybeSingle();

    setContract(contractData || null);
    setLoading(false);
  }, [gigId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate() {
    const { error } = await supabase.from('contracts').insert({ gig_id: gigId, status: 'draft' });
    if (error) {
      setError(error.message);
      return;
    }
    load();
    setEditing(true);
  }

  if (loading) return <p className="state-message">Loading contract…</p>;
  if (!isAdmin) return null;

  if (!contract) {
    return (
      <div className="roster-section">
        <h3 className="roster-section__title">Contract</h3>
        <p className="state-message" style={{ textAlign: 'left', padding: 0 }}>No contract yet for this gig.</p>
        {error && <p className="form-error">{error}</p>}
        <button className="btn btn--primary btn--small" style={{ marginTop: 12 }} onClick={handleCreate}>
          Create contract
        </button>
      </div>
    );
  }

  const locked = contract.status === 'signed';

  return (
    <div className="roster-section">
      <div className="section-header">
        <h3 className="roster-section__title">Contract</h3>
        <span className={`status-tag status-tag--${contract.status}`}>{contract.status}</span>
      </div>

      {editing
        ? <ContractEditor contract={contract} gigFeeAmount={gigFeeAmount} onSaved={() => { setEditing(false); load(); }} />
        : (
          <>
            <dl className="detail-list">
              <dt>Fee</dt><dd>{gigFeeAmount != null ? '£' + Number(gigFeeAmount).toFixed(2) : '—'}</dd>
              <dt>Deposit</dt><dd>{contract.deposit_amount_pence != null ? '£' + poundsFromPence(contract.deposit_amount_pence) : '—'}</dd>
              <dt>Deposit due</dt><dd>{contract.deposit_due_date || '—'}</dd>
              <dt>Balance due</dt><dd>{contract.balance_due_date || '—'}</dd>
              <dt>Band signed</dt><dd>{contract.band_signee_name ? `${contract.band_signee_name} (${contract.band_signed_date || 'no date'})` : '—'}</dd>
              <dt>Client signed</dt><dd>{contract.client_signee_name ? `${contract.client_signee_name} (${contract.client_signed_date || 'no date'})` : '—'}</dd>
            </dl>

            {contract.cancellation_policy && (
              <div className="field" style={{ marginTop: 12 }}>
                <span className="field__label">Cancellation policy</span>
                <p className="u-pre-line" style={{ margin: 0 }}>{contract.cancellation_policy}</p>
              </div>
            )}

            {contract.additional_terms && (
              <div className="field" style={{ marginTop: 12 }}>
                <span className="field__label">Additional terms</span>
                <p className="u-pre-line" style={{ margin: 0 }}>{contract.additional_terms}</p>
              </div>
            )}

            <div className="field" style={{ marginTop: 12 }}>
              <span className="field__label">Client view link</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  value={window.location.origin + '/contract/' + contract.share_token}
                  readOnly
                  style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13, background: 'var(--paper)', fontFamily: 'var(--font-mono)' }}
                />
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  onClick={() => navigator.clipboard.writeText(window.location.origin + '/contract/' + contract.share_token)}
                >
                  Copy
                </button>
              </div>
            </div>

            {locked && (
              <p className="field__hint">Marked signed and locked from edits or deletion.</p>
            )}

            <div className="form-actions">
              {!locked && (
                <>
                  <button className="btn btn--ghost" onClick={async () => {
                    const ok = await confirmAsync('Delete this contract? This cannot be undone.');
                    if (!ok) return;
                    const { error } = await supabase.from('contracts').delete().eq('id', contract.id);
                    if (error) { alert("Couldn't delete: " + error.message); return; }
                    setContract(null);
                  }}>
                    Delete contract
                  </button>
                  <button className="btn btn--ghost" onClick={() => setEditing(true)}>Edit</button>
                </>
              )}
              <button className="btn btn--primary" onClick={() => setShowPrint(true)}>
                Export PDF
              </button>
            </div>
          </>
        )
      }

      {showPrint && (
        <ContractPrintModal
          contract={contract}
          gig={gig}
          band={band}
          client={client}
          gigFeeAmount={gigFeeAmount}
          onClose={() => setShowPrint(false)}
        />
      )}
    </div>
  );
}

function ContractEditor({ contract, onSaved }) {
  const [status, setStatus] = useState(contract.status);
  const [depositAmount, setDepositAmount] = useState(contract.deposit_amount_pence != null ? (contract.deposit_amount_pence / 100).toFixed(2) : '');
  const [depositDueDate, setDepositDueDate] = useState(contract.deposit_due_date || '');
  const [balanceDueDate, setBalanceDueDate] = useState(contract.balance_due_date || '');
  const [cancellationPolicy, setCancellationPolicy] = useState(contract.cancellation_policy || '');
  const [additionalTerms, setAdditionalTerms] = useState(contract.additional_terms || '');
  const [bandSigneeName, setBandSigneeName] = useState(contract.band_signee_name || '');
  const [bandSignedDate, setBandSignedDate] = useState(contract.band_signed_date || '');
  const [clientSigneeName, setClientSigneeName] = useState(contract.client_signee_name || '');
  const [clientSignedDate, setClientSignedDate] = useState(contract.client_signed_date || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const { error } = await supabase
      .from('contracts')
      .update({
        status,
        deposit_amount_pence: depositAmount === '' ? null : Math.round(Number(depositAmount) * 100),
        deposit_due_date: depositDueDate || null,
        balance_due_date: balanceDueDate || null,
        cancellation_policy: cancellationPolicy || null,
        additional_terms: additionalTerms || null,
        band_signee_name: bandSigneeName || null,
        band_signed_date: bandSignedDate || null,
        client_signee_name: clientSigneeName || null,
        client_signed_date: clientSignedDate || null,
      })
      .eq('id', contract.id);

    setSaving(false);
    if (error) { setError(error.message); return; }
    onSaved();
  }

  return (
    <form onSubmit={handleSave}>
      <div className="field-row">
        <label className="field">
          <span className="field__label">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
            <option value="signed">Signed</option>
          </select>
        </label>
        <label className="field">
          <span className="field__label">Deposit (£)</span>
          <input type="number" step="0.01" min="0" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} placeholder="e.g. 250.00" />
        </label>
      </div>

      <div className="field-row">
        <label className="field">
          <span className="field__label">Deposit due</span>
          <input type="date" value={depositDueDate} onChange={(e) => setDepositDueDate(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Balance due</span>
          <input type="date" value={balanceDueDate} onChange={(e) => setBalanceDueDate(e.target.value)} />
        </label>
      </div>

      <label className="field">
        <span className="field__label">Cancellation policy</span>
        <textarea value={cancellationPolicy} onChange={(e) => setCancellationPolicy(e.target.value)} rows={3}
          placeholder="e.g. A cancellation more than 90 days before the event forfeits the deposit only..." />
      </label>

      <label className="field">
        <span className="field__label">Additional terms</span>
        <textarea value={additionalTerms} onChange={(e) => setAdditionalTerms(e.target.value)} rows={3} />
      </label>

      <p className="field__label" style={{ marginTop: 16, marginBottom: 8, fontWeight: 700 }}>Signatures</p>
      <p className="field__hint" style={{ marginBottom: 8 }}>
        Recorded manually once a signature has been obtained outside the app (email reply, physical copy, etc.) — not captured here.
      </p>

      <div className="field-row">
        <label className="field">
          <span className="field__label">Signed for the band by</span>
          <input value={bandSigneeName} onChange={(e) => setBandSigneeName(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Date</span>
          <input type="date" value={bandSignedDate} onChange={(e) => setBandSignedDate(e.target.value)} />
        </label>
      </div>

      <div className="field-row">
        <label className="field">
          <span className="field__label">Signed for the client by</span>
          <input value={clientSigneeName} onChange={(e) => setClientSigneeName(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Date</span>
          <input type="date" value={clientSignedDate} onChange={(e) => setClientSignedDate(e.target.value)} />
        </label>
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="form-actions">
        <button type="submit" className="btn btn--primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save contract'}
        </button>
      </div>
    </form>
  );
}

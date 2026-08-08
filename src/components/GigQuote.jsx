import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useCurrentProfile } from '../context/ProfileContext.jsx';
import QuotePrintModal from './QuotePrintModal.jsx';
import { confirmAsync } from '../utils/confirmService.js';
import { notify } from '../utils/toastService.js';
import { friendlyDbError } from '../utils/friendlyDbError.js';

function poundsFromPence(pence) {
  return (pence / 100).toFixed(2);
}

export default function GigQuote({ gigId, gigFeeAmount, onConverted }) {
  const { isAdmin: isAdminRole, isBandLeader } = useCurrentProfile();
  const isAdmin = isAdminRole || isBandLeader;
  const [quote, setQuote] = useState(null);
  const [items, setItems] = useState([]);
  const [gig, setGig] = useState(null);
  const [band, setBand] = useState(null);
  const [client, setClient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [showPrint, setShowPrint] = useState(false);
  const [creating, setCreating] = useState(false);
  const [converting, setConverting] = useState(false);
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

    const { data: quoteData, error: quoteLoadError } = await supabase
      .from('quotes')
      .select('*')
      .eq('gig_id', gigId)
      .maybeSingle();

    if (quoteLoadError) setError(quoteLoadError.message);

    if (quoteData) {
      setQuote(quoteData);
      const { data: itemData } = await supabase
        .from('quote_items')
        .select('*')
        .eq('quote_id', quoteData.id)
        .order('sort_order');
      setItems(itemData || []);
    }

    setLoading(false);
  }, [gigId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate() {
    if (creating) return;
    setCreating(true);
    setError(null);

    const issuedDate = new Date();
    const validUntil = new Date(issuedDate);
    validUntil.setDate(validUntil.getDate() + 30);

    const { data: newQuote, error } = await supabase
      .from('quotes')
      .insert({
        gig_id: gigId,
        status: 'draft',
        issued_date: issuedDate.toISOString().slice(0, 10),
        valid_until: validUntil.toISOString().slice(0, 10),
      })
      .select()
      .single();

    if (error) {
      setError(friendlyDbError(error));
      setCreating(false);
      return;
    }

    if (gigFeeAmount) {
      await supabase.from('quote_items').insert({
        quote_id: newQuote.id,
        description: 'Band performance fee',
        quantity: 1,
        unit_amount_pence: Math.round(gigFeeAmount * 100),
        sort_order: 0,
      });
    }

    setCreating(false);
    load();
    setEditing(true);
  }

  async function handleConvertToInvoice() {
    if (converting) return;
    setConverting(true);
    setError(null);

    const issuedDate = new Date();
    const dueDate = new Date(issuedDate);
    dueDate.setDate(dueDate.getDate() + 7);

    const { data: newInvoice, error: invError } = await supabase
      .from('invoices')
      .insert({
        gig_id: gigId,
        status: 'draft',
        issued_date: issuedDate.toISOString().slice(0, 10),
        due_date: dueDate.toISOString().slice(0, 10),
      })
      .select()
      .single();

    if (invError) {
      setError(friendlyDbError(invError));
      setConverting(false);
      return;
    }

    if (items.length > 0) {
      const { error: itemsError } = await supabase.from('invoice_items').insert(
        items.map((item) => ({
          invoice_id: newInvoice.id,
          description: item.description,
          quantity: item.quantity,
          unit_amount_pence: item.unit_amount_pence,
          sort_order: item.sort_order,
        }))
      );
      if (itemsError) {
        setError(itemsError.message);
        setConverting(false);
        return;
      }
    }

    const { error: linkError } = await supabase
      .from('quotes')
      .update({ converted_invoice_id: newInvoice.id })
      .eq('id', quote.id);

    setConverting(false);
    if (linkError) {
      setError(linkError.message);
      return;
    }

    load();
    onConverted?.();
  }

  if (loading) return <p className="state-message">Loading quote…</p>;
  if (!isAdmin) return null;

  if (!quote) {
    return (
      <div className="roster-section">
        <h3 className="roster-section__title">Quote</h3>
        <p className="state-message" style={{ textAlign: 'left', padding: 0 }}>No quote yet for this gig.</p>
        {!gig?.band_id && (
          <p className="field__hint" style={{ marginTop: 6 }}>
            Tip: assign a band to this gig first so the quote includes your contact details automatically.
          </p>
        )}
        {error && <p className="form-error">{error}</p>}
        <button className="btn btn--primary btn--small" style={{ marginTop: 12 }} onClick={handleCreate} disabled={creating}>
          {creating ? 'Creating…' : 'Create quote'}
        </button>
      </div>
    );
  }

  const total = items.reduce((sum, i) => sum + i.unit_amount_pence * i.quantity, 0);
  const locked = Boolean(quote.converted_invoice_id);

  return (
    <div className="roster-section">
      <div className="section-header">
        <h3 className="roster-section__title">Quote</h3>
        <span className={`status-tag status-tag--${quote.status}`}>{quote.status}</span>
      </div>

      {editing
        ? <QuoteEditor quote={quote} items={items} onSaved={() => { setEditing(false); load(); }} />
        : (
          <>
            <dl className="detail-list">
              <dt>Issued</dt><dd>{quote.issued_date || '—'}</dd>
              <dt>Valid until</dt><dd>{quote.valid_until || '—'}</dd>
              <dt>Total</dt><dd><strong>£{poundsFromPence(total)}</strong></dd>
            </dl>

            <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table className="travel-table">
              <thead>
                <tr><th>Description</th><th>Qty</th><th>Unit</th><th>Amount</th></tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.description}</td>
                    <td>{item.quantity}</td>
                    <td>£{poundsFromPence(item.unit_amount_pence)}</td>
                    <td>£{poundsFromPence(item.unit_amount_pence * item.quantity)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}><strong>Total</strong></td>
                  <td><strong>£{poundsFromPence(total)}</strong></td>
                </tr>
              </tfoot>
            </table>
            </div>

            <div className="field" style={{ marginTop: 12 }}>
              <span className="field__label">Client view link</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  value={window.location.origin + '/quote/' + quote.share_token}
                  readOnly
                  style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13, background: 'var(--paper)', fontFamily: 'var(--font-mono)' }}
                />
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  onClick={() => navigator.clipboard.writeText(window.location.origin + '/quote/' + quote.share_token)}
                >
                  Copy
                </button>
              </div>
            </div>

            {locked && (
              <p className="field__hint">Converted to invoice — locked from further edits. Manage billing from the Invoice section below.</p>
            )}

            {quote.status === 'accepted' && !locked && (
              <p className="field__hint">Accepted — ready to convert into an invoice whenever you're ready to bill.</p>
            )}

            {error && <p className="form-error">{error}</p>}

            <div className="form-actions">
              {!locked && (
                <>
                  <button className="btn btn--ghost" onClick={async () => {
                    const ok = await confirmAsync('Delete this quote? This cannot be undone.');
                    if (!ok) return;
                    const { error } = await supabase.from('quotes').delete().eq('id', quote.id);
                    if (error) { notify("Couldn't delete: " + error.message); return; }
                    setQuote(null);
                    setItems([]);
                  }}>
                    Delete quote
                  </button>
                  <button className="btn btn--ghost" onClick={() => setEditing(true)}>Edit</button>
                </>
              )}
              {quote.status === 'accepted' && !locked && (
                <button className="btn btn--ghost" onClick={handleConvertToInvoice} disabled={converting}>
                  {converting ? 'Converting…' : 'Convert to invoice'}
                </button>
              )}
              <button className="btn btn--primary" onClick={() => setShowPrint(true)}>
                Export PDF
              </button>
            </div>
          </>
        )
      }

      {showPrint && (
        <QuotePrintModal
          quote={quote}
          items={items}
          gig={gig}
          band={band}
          client={client}
          onClose={() => setShowPrint(false)}
        />
      )}
    </div>
  );
}

function QuoteEditor({ quote, items: initialItems, onSaved }) {
  const [status, setStatus] = useState(quote.status);
  const [issuedDate, setIssuedDate] = useState(quote.issued_date || '');
  const [validUntil, setValidUntil] = useState(quote.valid_until || '');
  const [notes, setNotes] = useState(quote.notes || '');
  const [items, setItems] = useState(initialItems.map((i) => ({ ...i })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function addItem() {
    setItems([...items, { id: null, description: '', quantity: 1, unit_amount_pence: 0, sort_order: items.length }]);
  }
  function updateItem(index, field, value) {
    setItems(items.map((item, i) => (i === index ? { ...item, [field]: value } : item)));
  }
  function removeItem(index) {
    setItems(items.filter((_, i) => i !== index));
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const { error: quoteError } = await supabase
      .from('quotes')
      .update({ status, issued_date: issuedDate || null, valid_until: validUntil || null, notes: notes || null })
      .eq('id', quote.id);

    if (quoteError) { setError(quoteError.message); setSaving(false); return; }

    const { error: deleteError } = await supabase.from('quote_items').delete().eq('quote_id', quote.id);
    if (deleteError) { setError(deleteError.message); setSaving(false); return; }
    if (items.length > 0) {
      const { error: itemsError } = await supabase.from('quote_items').insert(
        items.map((item, i) => ({
          quote_id: quote.id,
          description: item.description,
          quantity: Number(item.quantity) || 1,
          unit_amount_pence: Math.round(Number(item.unit_amount_pence) || 0),
          sort_order: i,
        }))
      );
      if (itemsError) { setError(itemsError.message); setSaving(false); return; }
    }

    setSaving(false);
    onSaved();
  }

  const total = items.reduce((sum, i) => sum + (Number(i.unit_amount_pence) || 0) * (Number(i.quantity) || 1), 0);

  return (
    <form onSubmit={handleSave}>
      <div className="field-row">
        <label className="field">
          <span className="field__label">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
            <option value="accepted">Accepted</option>
            <option value="declined">Declined</option>
            <option value="expired">Expired</option>
          </select>
        </label>
        <label className="field">
          <span className="field__label">Issued</span>
          <input type="date" value={issuedDate} onChange={(e) => setIssuedDate(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Valid until</span>
          <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
        </label>
      </div>

      <div className="field" style={{ marginTop: 8 }}>
        <span className="field__label">Line items</span>
        <div style={{ overflowX: 'auto' }}>
        <table className="travel-table">
          <thead>
            <tr><th>Description</th><th style={{ width: 60 }}>Qty</th><th style={{ width: 100 }}>Unit (£)</th><th style={{ width: 90 }}>Total</th><th></th></tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={i}>
                <td>
                  <input value={item.description} onChange={(e) => updateItem(i, 'description', e.target.value)}
                    style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 6, padding: '4px 6px' }} />
                </td>
                <td>
                  <input type="number" min="1" step="0.5" value={item.quantity} onChange={(e) => updateItem(i, 'quantity', e.target.value)}
                    style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 6, padding: '4px 6px' }} />
                </td>
                <td>
                  <input type="number" step="0.01" value={(item.unit_amount_pence / 100).toFixed(2)}
                    onChange={(e) => updateItem(i, 'unit_amount_pence', Math.round(Number(e.target.value) * 100))}
                    style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 6, padding: '4px 6px' }} />
                </td>
                <td>£{poundsFromPence((Number(item.unit_amount_pence) || 0) * (Number(item.quantity) || 1))}</td>
                <td><button type="button" className="link-button link-button--danger" onClick={() => removeItem(i)}>×</button></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}><strong>Total</strong></td>
              <td><strong>£{poundsFromPence(total)}</strong></td>
              <td></td>
            </tr>
          </tfoot>
        </table>
        </div>
        <button type="button" className="link-button" style={{ marginTop: 8 }} onClick={addItem}>+ Add line item</button>
      </div>

      <label className="field" style={{ marginTop: 8 }}>
        <span className="field__label">Quote notes</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
      </label>

      {error && <p className="form-error">{error}</p>}

      <div className="form-actions">
        <button type="submit" className="btn btn--primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save quote'}
        </button>
      </div>
    </form>
  );
}

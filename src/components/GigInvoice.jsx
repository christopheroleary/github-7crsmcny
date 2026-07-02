import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useCurrentProfile } from '../context/ProfileContext.jsx';
import InvoicePrintModal from './InvoicePrintModal.jsx';

function poundsFromPence(pence) {
  return (pence / 100).toFixed(2);
}

export default function GigInvoice({ gigId, gigFeeAmount, mileageRatePence }) {
  const { isAdmin } = useCurrentProfile();
  const [invoice, setInvoice] = useState(null);
  const [items, setItems] = useState([]);
  const [lineup, setLineup] = useState([]);
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

    const { data: invData } = await supabase
      .from('invoices')
      .select('*')
      .eq('gig_id', gigId)
      .maybeSingle();

    if (invData) {
      setInvoice(invData);
      const { data: itemData } = await supabase
        .from('invoice_items')
        .select('*')
        .eq('invoice_id', invData.id)
        .order('sort_order');
      setItems(itemData || []);
    }

    const { data: lineupData } = await supabase
      .from('gig_lineup')
      .select('id, travel_cost_pence, profiles(full_name)')
      .eq('gig_id', gigId);
    setLineup(lineupData || []);

    setLoading(false);
  }, [gigId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate() {
    const { data: newInvoice, error } = await supabase
      .from('invoices')
      .insert({
        gig_id: gigId,
        status: 'draft',
        issued_date: new Date().toISOString().slice(0, 10),
      })
      .select()
      .single();

    if (error) {
      setError(error.message);
      return;
    }

    const defaultItems = [];
    if (gigFeeAmount) {
      defaultItems.push({
        invoice_id: newInvoice.id,
        description: 'Band performance fee',
        quantity: 1,
        unit_amount_pence: Math.round(gigFeeAmount * 100),
        sort_order: 0,
      });
    }
    lineup.forEach((l, i) => {
      if (l.travel_cost_pence) {
        defaultItems.push({
          invoice_id: newInvoice.id,
          description: 'Travel — ' + (l.profiles?.full_name ?? 'Musician'),
          quantity: 1,
          unit_amount_pence: l.travel_cost_pence,
          sort_order: i + 1,
        });
      }
    });

    if (defaultItems.length > 0) {
      await supabase.from('invoice_items').insert(defaultItems);
    }

    load();
    setEditing(true);
  }

  if (loading) return <p className="state-message">Loading invoice…</p>;
  if (!isAdmin) return null;

  if (!invoice) {
    return (
      <div className="roster-section">
        <h3 className="roster-section__title">Invoice</h3>
        <p className="state-message" style={{ textAlign: 'left', padding: 0 }}>No invoice yet for this gig.</p>
        {!gig?.band_id && (
          <p className="field__hint" style={{ marginTop: 6 }}>
            Tip: assign a band to this gig first so the invoice includes your contact and payment details automatically.
          </p>
        )}
        {error && <p className="form-error">{error}</p>}
        <button className="btn btn--primary btn--small" style={{ marginTop: 12 }} onClick={handleCreate}>
          Create invoice
        </button>
      </div>
    );
  }

  const total = items.reduce((sum, i) => sum + i.unit_amount_pence * i.quantity, 0);

  return (
    <div className="roster-section">
      <div className="section-header">
        <h3 className="roster-section__title">Invoice</h3>
        <span className={`status-tag status-tag--${invoice.status}`}>{invoice.status}</span>
      </div>

      {editing
        ? <InvoiceEditor invoice={invoice} items={items} onSaved={() => { setEditing(false); load(); }} />
        : (
          <>
            <dl className="detail-list">
              <dt>Issued</dt><dd>{invoice.issued_date || '—'}</dd>
              <dt>Due</dt><dd>{invoice.due_date || '—'}</dd>
              <dt>Paid</dt><dd>{invoice.paid_date || '—'}</dd>
              <dt>Total</dt><dd><strong>£{poundsFromPence(total)}</strong></dd>
            </dl>

            <table className="travel-table" style={{ marginTop: 8 }}>
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

            <div className="field" style={{ marginTop: 12 }}>
              <span className="field__label">Client payment link</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  value={window.location.origin + '/invoice/' + invoice.share_token}
                  readOnly
                  style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13, background: 'var(--paper)', fontFamily: 'var(--font-mono)' }}
                />
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  onClick={() => navigator.clipboard.writeText(window.location.origin + '/invoice/' + invoice.share_token)}
                >
                  Copy
                </button>
              </div>
            </div>

            <div className="form-actions">
              <button className="btn btn--ghost" onClick={async () => {
                const ok = window.confirm('Delete this invoice? This cannot be undone.');
                if (!ok) return;
                await supabase.from('invoices').delete().eq('id', invoice.id);
                setInvoice(null);
                setItems([]);
              }}>
                Delete invoice
              </button>
              <button className="btn btn--ghost" onClick={() => setEditing(true)}>Edit</button>
              <button className="btn btn--primary" onClick={() => setShowPrint(true)}>
                Export PDF
              </button>
            </div>
          </>
        )
      }

      {showPrint && (
        <InvoicePrintModal
          invoice={invoice}
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

function InvoiceEditor({ invoice, items: initialItems, onSaved }) {
  const [status, setStatus] = useState(invoice.status);
  const [issuedDate, setIssuedDate] = useState(invoice.issued_date || '');
  const [dueDate, setDueDate] = useState(invoice.due_date || '');
  const [paidDate, setPaidDate] = useState(invoice.paid_date || '');
  const [notes, setNotes] = useState(invoice.notes || '');
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

    const { error: invError } = await supabase
      .from('invoices')
      .update({ status, issued_date: issuedDate || null, due_date: dueDate || null, paid_date: paidDate || null, notes: notes || null })
      .eq('id', invoice.id);

    if (invError) { setError(invError.message); setSaving(false); return; }

    await supabase.from('invoice_items').delete().eq('invoice_id', invoice.id);
    if (items.length > 0) {
      const { error: itemsError } = await supabase.from('invoice_items').insert(
        items.map((item, i) => ({
          invoice_id: invoice.id,
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
            <option value="paid">Paid</option>
            <option value="overdue">Overdue</option>
          </select>
        </label>
        <label className="field">
          <span className="field__label">Issued</span>
          <input type="date" value={issuedDate} onChange={(e) => setIssuedDate(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Due</span>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Paid</span>
          <input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
        </label>
      </div>

      <div className="field" style={{ marginTop: 8 }}>
        <span className="field__label">Line items</span>
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
        <button type="button" className="link-button" style={{ marginTop: 8 }} onClick={addItem}>+ Add line item</button>
      </div>

      <label className="field" style={{ marginTop: 8 }}>
        <span className="field__label">Invoice notes</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
      </label>

      {error && <p className="form-error">{error}</p>}

      <div className="form-actions">
        <button type="submit" className="btn btn--primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save invoice'}
        </button>
      </div>
    </form>
  );
}
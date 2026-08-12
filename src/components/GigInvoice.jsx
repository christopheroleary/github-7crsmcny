import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useCurrentProfile } from '../context/ProfileContext.jsx';
import InvoicePrintModal from './InvoicePrintModal.jsx';
import LineItemsEditor from './LineItemsEditor.jsx';
import DateInput from './DateInput.jsx';
import NumberInput from './NumberInput.jsx';
import { confirmAsync } from '../utils/confirmService.js';
import { notify } from '../utils/toastService.js';
import { friendlyDbError } from '../utils/friendlyDbError.js';

function poundsFromPence(pence) {
  return (pence / 100).toFixed(2);
}

function vatPenceFor(subtotalPence, ratePercent) {
  return Math.round(subtotalPence * (ratePercent / 100));
}

export default function GigInvoice({ gigId, gigFeeAmount, mileageRatePence }) {
  const { isAdmin: isAdminRole, isBandLeader } = useCurrentProfile();
  const isAdmin = isAdminRole || isBandLeader;
  const [invoice, setInvoice] = useState(null);
  const [items, setItems] = useState([]);
  const [payments, setPayments] = useState([]);
  const [lineup, setLineup] = useState([]);
  const [gig, setGig] = useState(null);
  const [band, setBand] = useState(null);
  const [client, setClient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [showPrint, setShowPrint] = useState(false);
  const [creating, setCreating] = useState(false);
  const [addingPayment, setAddingPayment] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState('');
  const [paymentNote, setPaymentNote] = useState('');
  const [savingPayment, setSavingPayment] = useState(false);
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

    const { data: invData, error: invLoadError } = await supabase
      .from('invoices')
      .select('*')
      .eq('gig_id', gigId)
      .maybeSingle();

    if (invLoadError) setError(invLoadError.message);

    if (invData) {
      setInvoice(invData);
      const [{ data: itemData }, { data: paymentData }] = await Promise.all([
        supabase.from('invoice_items').select('*').eq('invoice_id', invData.id).order('sort_order'),
        supabase.from('invoice_payments').select('*').eq('invoice_id', invData.id).order('paid_date'),
      ]);
      setItems(itemData || []);
      setPayments(paymentData || []);
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
    if (creating) return;
    setCreating(true);
    setError(null);

    const issuedDate = new Date();
    const dueDate = new Date(issuedDate);
    dueDate.setDate(dueDate.getDate() + 7);

    const { data: newInvoice, error } = await supabase
      .from('invoices')
      .insert({
        gig_id: gigId,
        status: 'draft',
        issued_date: issuedDate.toISOString().slice(0, 10),
        due_date: dueDate.toISOString().slice(0, 10),
      })
      .select()
      .single();

    if (error) {
      setError(friendlyDbError(error));
      setCreating(false);
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

    setCreating(false);
    load();
    setEditing(true);
  }

  // Keeps invoice.status in sync with the payments ledger: flips to 'paid'
  // the moment recorded payments cover the total, and back to 'sent' if a
  // payment is later removed/reduced below that -- but never touches
  // status if it was set some other way (e.g. an admin manually marking a
  // cash-in-hand payment as 'paid' with no ledger entry at all).
  async function syncStatusToPayments(invoiceId, currentStatus, totalPaidPence, totalDuePence) {
    if (totalDuePence > 0 && totalPaidPence >= totalDuePence && currentStatus !== 'paid') {
      const latestDate = payments.reduce((max, p) => (p.paid_date > max ? p.paid_date : max), paymentDate || '');
      await supabase.from('invoices').update({ status: 'paid', paid_date: latestDate || null }).eq('id', invoiceId);
    } else if (currentStatus === 'paid' && totalPaidPence < totalDuePence) {
      await supabase.from('invoices').update({ status: 'sent', paid_date: null }).eq('id', invoiceId);
    }
  }

  function startAddPayment() {
    setPaymentAmount('');
    setPaymentDate(new Date().toISOString().slice(0, 10));
    setPaymentNote('');
    setError(null);
    setAddingPayment(true);
  }

  async function handleAddPayment(e) {
    e.preventDefault();
    setSavingPayment(true);
    setError(null);

    const amountPence = Math.round(Number(paymentAmount) * 100);
    if (!amountPence || amountPence <= 0) {
      setError('Enter a valid amount.');
      setSavingPayment(false);
      return;
    }

    const { error: saveError } = await supabase.from('invoice_payments').insert({
      invoice_id: invoice.id,
      amount_pence: amountPence,
      paid_date: paymentDate || new Date().toISOString().slice(0, 10),
      note: paymentNote.trim() || null,
    });

    if (saveError) {
      setError(saveError.message);
      setSavingPayment(false);
      return;
    }

    const newTotalPaid = payments.reduce((sum, p) => sum + p.amount_pence, 0) + amountPence;
    await syncStatusToPayments(invoice.id, invoice.status, newTotalPaid, grandTotal);

    setSavingPayment(false);
    setAddingPayment(false);
    load();
  }

  async function handleDeletePayment(payment) {
    const ok = await confirmAsync(`Remove the £${poundsFromPence(payment.amount_pence)} payment recorded on ${payment.paid_date}?`);
    if (!ok) return;
    const { error: deleteError } = await supabase.from('invoice_payments').delete().eq('id', payment.id);
    if (deleteError) {
      notify("Couldn't remove payment: " + deleteError.message);
      return;
    }
    const newTotalPaid = payments.reduce((sum, p) => sum + p.amount_pence, 0) - payment.amount_pence;
    await syncStatusToPayments(invoice.id, invoice.status, newTotalPaid, grandTotal);
    load();
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
        <button className="btn btn--primary btn--small" style={{ marginTop: 12 }} onClick={handleCreate} disabled={creating}>
          {creating ? 'Creating…' : 'Create invoice'}
        </button>
      </div>
    );
  }

  const total = items.reduce((sum, i) => sum + i.unit_amount_pence * i.quantity, 0);
  const vatRate = band?.vat_rate || 0;
  const vatPence = vatPenceFor(total, vatRate);
  const grandTotal = total + vatPence;
  const totalPaid = payments.reduce((sum, p) => sum + p.amount_pence, 0);
  const balance = grandTotal - totalPaid;

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
              {vatRate > 0 ? (
                <>
                  <dt>Subtotal</dt><dd>£{poundsFromPence(total)}</dd>
                  <dt>VAT ({vatRate}%)</dt><dd>£{poundsFromPence(vatPence)}</dd>
                  <dt>Total</dt><dd><strong>£{poundsFromPence(grandTotal)}</strong></dd>
                </>
              ) : (
                <><dt>Total</dt><dd><strong>£{poundsFromPence(grandTotal)}</strong></dd></>
              )}
              {totalPaid > 0 && (
                <>
                  <dt>Paid so far</dt><dd>£{poundsFromPence(totalPaid)}</dd>
                  <dt>Balance due</dt>
                  <dd>
                    <strong style={{ color: balance > 0 ? 'var(--rust)' : 'var(--teal)' }}>
                      £{poundsFromPence(Math.max(0, balance))}
                    </strong>
                  </dd>
                </>
              )}
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
                {vatRate > 0 ? (
                  <>
                    <tr><td colSpan={3}>Subtotal</td><td>£{poundsFromPence(total)}</td></tr>
                    <tr><td colSpan={3}>VAT ({vatRate}%)</td><td>£{poundsFromPence(vatPence)}</td></tr>
                    <tr><td colSpan={3}><strong>Total</strong></td><td><strong>£{poundsFromPence(grandTotal)}</strong></td></tr>
                  </>
                ) : (
                  <tr><td colSpan={3}><strong>Total</strong></td><td><strong>£{poundsFromPence(grandTotal)}</strong></td></tr>
                )}
              </tfoot>
            </table>
            </div>

            <div className="field" style={{ marginTop: 12 }}>
              <span className="field__label">Payments received</span>
              {payments.length === 0 && <p className="field__hint">No payments recorded yet.</p>}
              {payments.length > 0 && (
                <ul className="simple-list" style={{ marginTop: 4 }}>
                  {payments.map((p) => (
                    <li className="simple-list__item" key={p.id}>
                      <div className="simple-list__row">
                        <div>
                          <span className="simple-list__title">£{poundsFromPence(p.amount_pence)}</span>
                          <span className="simple-list__subtitle">{p.paid_date}{p.note ? ' · ' + p.note : ''}</span>
                        </div>
                        <button className="link-button link-button--danger" onClick={() => handleDeletePayment(p)}>Remove</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {!addingPayment && balance > 0 && (
                <button type="button" className="btn btn--ghost btn--small" style={{ marginTop: 8 }} onClick={startAddPayment}>
                  + Record payment
                </button>
              )}

              {addingPayment && (
                <form className="inline-subform" onSubmit={handleAddPayment} style={{ marginTop: 8 }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <label className="field" style={{ flex: '1 1 100px' }}>
                      <span className="field__label">Amount (£)</span>
                      <NumberInput
                        decimals={2}
                        min={0.01}
                        prefix="£"
                        value={paymentAmount}
                        onChange={(e) => setPaymentAmount(e.target.value)}
                        placeholder={poundsFromPence(Math.max(0, balance))}
                        required
                      />
                    </label>
                    <label className="field" style={{ flex: '1 1 140px' }}>
                      <span className="field__label">Date</span>
                      <DateInput value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} required />
                    </label>
                  </div>
                  <label className="field">
                    <span className="field__label">Note (optional)</span>
                    <input value={paymentNote} onChange={(e) => setPaymentNote(e.target.value)} placeholder="e.g. Deposit" />
                  </label>
                  {error && <p className="form-error">{error}</p>}
                  <div className="form-actions">
                    <button type="button" className="btn btn--ghost btn--small" onClick={() => setAddingPayment(false)}>
                      Cancel
                    </button>
                    <button type="submit" className="btn btn--primary btn--small" disabled={savingPayment}>
                      {savingPayment ? 'Saving…' : 'Record payment'}
                    </button>
                  </div>
                </form>
              )}
            </div>

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

            {invoice.status === 'paid' && (
              <p className="field__hint">Invoice is marked paid and locked from edits or deletion.</p>
            )}

            <div className="form-actions">
              {invoice.status !== 'paid' && (
                <>
                  <button className="btn btn--ghost" onClick={async () => {
                    const ok = await confirmAsync('Delete this invoice? This cannot be undone.');
                    if (!ok) return;
                    const { error } = await supabase.from('invoices').delete().eq('id', invoice.id);
                    if (error) { notify("Couldn't delete: " + error.message); return; }
                    setInvoice(null);
                    setItems([]);
                  }}>
                    Delete invoice
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
        <InvoicePrintModal
          invoice={invoice}
          items={items}
          payments={payments}
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

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const { error: invError } = await supabase
      .from('invoices')
      .update({ status, issued_date: issuedDate || null, due_date: dueDate || null, paid_date: paidDate || null, notes: notes || null })
      .eq('id', invoice.id);

    if (invError) { setError(invError.message); setSaving(false); return; }

    const { error: deleteError } = await supabase.from('invoice_items').delete().eq('invoice_id', invoice.id);
    if (deleteError) { setError(deleteError.message); setSaving(false); return; }
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
          <DateInput value={issuedDate} onChange={(e) => setIssuedDate(e.target.value)} />
        </label>
      </div>
      <div className="field-row">
        <label className="field">
          <span className="field__label">Due</span>
          <DateInput value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Paid</span>
          <DateInput value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
        </label>
      </div>

      <div className="field" style={{ marginTop: 8 }}>
        <span className="field__label">Line items</span>
        <LineItemsEditor items={items} onChange={setItems} />
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
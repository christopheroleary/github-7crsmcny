import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import ShareLinkField from './ShareLinkField.jsx';
import { useCurrentProfile } from '../context/ProfileContext.jsx';
import { useIsOffline } from '../hooks/useIsOffline.js';
import InvoicePrintModal from './InvoicePrintModal.jsx';
import LineItemsEditor from './LineItemsEditor.jsx';
import DateInput from './DateInput.jsx';
import NumberInput from './NumberInput.jsx';
import { confirmAsync } from '../utils/confirmService.js';
import { notify } from '../utils/toastService.js';
import { friendlyDbError } from '../utils/friendlyDbError.js';
import InfoTooltip from './InfoTooltip.jsx';
import { Trash2 } from '../utils/stagePlotIcons.jsx';

function poundsFromPence(pence) {
  return (pence / 100).toFixed(2);
}

function vatPenceFor(subtotalPence, ratePercent) {
  return Math.round(subtotalPence * (ratePercent / 100));
}

// gig/client/band/venue/lineup all come from GigDetail, which already has
// them loaded (gig/lineup via useOfflineGigData, client/band/venue via its
// own single shared fetch) -- fetching any of them again here would just
// repeat a query GigDetail already ran, for the same gig, moments earlier.
export default function GigInvoice({ gigId, gig, client, band, venue, lineup = [], gigFeeAmount, mileageRatePence }) {
  const { isAdmin: isAdminRole, isBandLeader, isPro } = useCurrentProfile();
  const isAdmin = isAdminRole || isBandLeader;
  const [invoice, setInvoice] = useState(null);
  const [items, setItems] = useState([]);
  const [payments, setPayments] = useState([]);
  // Resolved billing details for invoice.bill_to_band_id/bill_to_venue_id,
  // when set -- fetched independently BY ID rather than reused from the
  // `venue` prop (the gig's current venue), because those can drift apart:
  // the gig's venue can be changed after an invoice was billed to it, and
  // the invoice must keep showing/emailing whoever it was actually billed
  // to, not wherever the gig happens to point today. Same reasoning as
  // billToBandDetails, which already worked this way.
  const [billToBandDetails, setBillToBandDetails] = useState(null);
  const [billToVenueDetails, setBillToVenueDetails] = useState(null);
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
    setError(null);

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

      if (invData.bill_to_band_id) {
        const { data: bandRow } = await supabase
          .from('bands')
          .select('id, name, invoice_name, contact_email, contact_phone, address')
          .eq('id', invData.bill_to_band_id)
          .maybeSingle();
        setBillToBandDetails(bandRow || null);
      } else {
        setBillToBandDetails(null);
      }

      if (invData.bill_to_venue_id) {
        const { data: venueRow } = await supabase
          .from('venues')
          .select('id, name, address, contact_name, phone, email')
          .eq('id', invData.bill_to_venue_id)
          .maybeSingle();
        setBillToVenueDetails(venueRow || null);
      } else {
        setBillToVenueDetails(null);
      }
    }

    setLoading(false);
  }, [gigId]);

  // Re-fetches the moment connectivity returns -- without this, a failed
  // load stayed on its error message even once back online.
  useIsOffline(load);

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

    // record_invoice_payment does the insert and the paid/sent status flip
    // atomically server-side -- the same RPC a Stripe webhook calls when a
    // client pays online, so there's exactly one place that status-sync
    // logic lives instead of two copies drifting apart.
    const { error: saveError } = await supabase.rpc('record_invoice_payment', {
      p_invoice_id: invoice.id,
      p_amount_pence: amountPence,
      p_paid_date: paymentDate || new Date().toISOString().slice(0, 10),
      p_note: paymentNote.trim() || null,
    });

    if (saveError) {
      setError(saveError.message);
      setSavingPayment(false);
      return;
    }

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
    const { error: syncError } = await supabase.rpc('sync_invoice_payment_status', { p_invoice_id: invoice.id });
    if (syncError) notify("Payment removed, but couldn't update invoice status: " + syncError.message);
    load();
  }

  if (loading) return <p className="state-message">Loading invoice…</p>;
  if (!isAdmin) return null;

  if (!invoice) {
    return (
      <div className="roster-section">
        <h3 className="roster-section__title">
          Invoice
          <InfoTooltip text="The bill sent to the client — track payments against it, and share a payment link they can pay online from." />
        </h3>
        <p className="state-message" style={{ textAlign: 'left', padding: 0 }}>No invoice yet for this gig.</p>
        {!gig?.band_id && (
          <p className="field__hint" style={{ marginTop: 6 }}>
            Tip: assign a band to this gig first so the invoice includes your contact and payment details automatically.
          </p>
        )}
        {error && <p className="form-error">{error}</p>}
        {isPro ? (
          <button className="btn btn--primary btn--small" style={{ marginTop: 12 }} onClick={handleCreate} disabled={creating}>
            {creating ? 'Creating…' : '+ Create invoice'}
          </button>
        ) : (
          <p className="field__hint" style={{ marginTop: 12 }}>Invoicing is a Pro feature — upgrade in My Profile to create one.</p>
        )}
      </div>
    );
  }

  const total = items.reduce((sum, i) => sum + i.unit_amount_pence * i.quantity, 0);
  const vatRate = band?.vat_rate || 0;
  const vatPence = vatPenceFor(total, vatRate);
  const grandTotal = total + vatPence;
  const totalPaid = payments.reduce((sum, p) => sum + p.amount_pence, 0);
  const balance = grandTotal - totalPaid;
  const billToLabel = invoice.bill_to_band_id
    ? (billToBandDetails?.invoice_name || billToBandDetails?.name || '(Unable to load bill-to band details)')
    : invoice.bill_to_venue_id
    ? (billToVenueDetails?.name || '(Unable to load bill-to venue details)')
    : (client?.name || '—');

  return (
    <div className="roster-section">
      <div className="section-header">
        <h3 className="roster-section__title">
          Invoice
          <InfoTooltip text="The bill sent to the client — track payments against it, and share a payment link they can pay online from." />
        </h3>
        <span className={`status-tag status-tag--${invoice.status}`}>{invoice.status}</span>
      </div>

      {editing
        ? (
          <InvoiceEditor
            invoice={invoice}
            items={items}
            client={client}
            venue={venue}
            billToBandDetails={billToBandDetails}
            onSaved={() => { setEditing(false); load(); }}
          />
        )
        : (
          <>
            <dl className="detail-list">
              <dt>Bill to</dt><dd>{billToLabel}</dd>
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
                          <span className="simple-list__title">
                            £{poundsFromPence(p.amount_pence)}
                            {p.stripe_payment_intent_id && (
                              <span className="status-tag status-tag--confirmed" style={{ marginLeft: 6, fontSize: 10 }}>Card</span>
                            )}
                          </span>
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

            <ShareLinkField docType="invoice" doc={invoice} onChange={setInvoice} label="Client payment link" />

            {invoice.status === 'paid' && (
              <p className="field__hint">Invoice is marked paid and locked from edits or deletion.</p>
            )}

            <div className="form-actions">
              {invoice.status !== 'paid' && (
                <>
                  <button className="btn btn--ghost-danger" style={{ gap: 6 }} onClick={async () => {
                    const ok = await confirmAsync('Delete this invoice? This cannot be undone.');
                    if (!ok) return;
                    const { error } = await supabase.from('invoices').delete().eq('id', invoice.id);
                    if (error) { notify("Couldn't delete: " + error.message); return; }
                    setInvoice(null);
                    setItems([]);
                  }}>
                    <Trash2 size={14} />
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
          billToVenue={billToVenueDetails}
          billToBand={billToBandDetails}
          onClose={() => setShowPrint(false)}
        />
      )}
    </div>
  );
}

function InvoiceEditor({ invoice, items: initialItems, client, venue, billToBandDetails, onSaved }) {
  const [status, setStatus] = useState(invoice.status);
  const [issuedDate, setIssuedDate] = useState(invoice.issued_date || '');
  const [dueDate, setDueDate] = useState(invoice.due_date || '');
  const [paidDate, setPaidDate] = useState(invoice.paid_date || '');
  const [notes, setNotes] = useState(invoice.notes || '');
  const [items, setItems] = useState(initialItems.map((i) => ({ ...i })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Who this invoice is actually addressed to. Defaults to Client --
  // today's only option, and what every existing invoice already is.
  // Venue/Another band are explicit overrides stored as bill_to_venue_id/
  // bill_to_band_id, resolved by InvoicePrintModal.jsx/
  // PublicDocumentView.jsx in preference order band > venue > client.
  // "Client" is never a separate pick from the gig's own client -- it
  // always saves all three bill_to_* columns null (see handleSave), which
  // is what keeps it a live fallback to gigs.client_id rather than a
  // pinned snapshot.
  const [billToType, setBillToType] = useState(
    invoice.bill_to_band_id ? 'band' : invoice.bill_to_venue_id ? 'venue' : 'client'
  );
  const [billToBandId, setBillToBandId] = useState(invoice.bill_to_band_id || '');
  const [bandOptions, setBandOptions] = useState([]);
  const [loadingBands, setLoadingBands] = useState(false);
  const [bandOptionsFetched, setBandOptionsFetched] = useState(false);

  // Fetched once, whenever "Another band" is the active choice -- on a
  // deliberate click, but also the moment this form mounts already showing
  // "Another band" (editing an invoice that already has one saved). Seeding
  // bandOptions from billToBandDetails directly (the earlier version of
  // this) was the actual bug: that made the "already 0 items? fetch" guard
  // below never see 0, so re-opening an invoice that already had a bill-to
  // band showed ONLY that one band and never fetched the rest -- confirmed
  // live. A plain useEffect keyed on billToType covers both the click and
  // the already-set-on-mount case with the same one code path.
  //
  // get_billable_bands() (not a raw bands select) is deliberately narrower
  // than "every band you lead" -- it's exactly the set can_view_band()
  // allows (created it / lead it / a member of it / played one of its
  // gigs), which is the real answer to "how would a real solo act even
  // have this band to pick": they created it (billing an agency they set
  // up as a band-of-one), lead it, or have actually played for it. It also
  // deliberately does NOT bypass for admin -- selecting a bill-to band
  // discloses that band's contact details on a public share link, and an
  // admin managing many unrelated bands company-wide shouldn't be able to
  // do that to a band it has no real connection to, any more than a
  // non-admin leader could.
  useEffect(() => {
    if (billToType !== 'band' || bandOptionsFetched) return;
    setLoadingBands(true);
    supabase.rpc('get_billable_bands').then(({ data }) => {
      let opts = data || [];
      // Defensive: if the currently-saved bill-to band somehow isn't in
      // that set (e.g. the relationship that made it visible when it was
      // first picked no longer holds), still show it as the selected
      // option rather than silently dropping what's actually saved.
      if (billToBandDetails && !opts.some((b) => b.id === billToBandDetails.id)) {
        opts = [...opts, { id: billToBandDetails.id, name: billToBandDetails.name }];
      }
      setBandOptions(opts);
      setBandOptionsFetched(true);
      setLoadingBands(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billToType, bandOptionsFetched]);

  function handleBillToTypeChange(type) {
    setBillToType(type);
  }

  async function handleSave(e) {
    e.preventDefault();
    setError(null);

    if (billToType === 'band' && !billToBandId) {
      setError('Choose which band to bill, or switch "Bill to" back to Client/Venue.');
      return;
    }

    setSaving(true);

    const { error: invError } = await supabase
      .from('invoices')
      .update({
        status, issued_date: issuedDate || null, due_date: dueDate || null, paid_date: paidDate || null, notes: notes || null,
        bill_to_client_id: null,
        bill_to_venue_id: billToType === 'venue' ? (venue?.id || null) : null,
        bill_to_band_id: billToType === 'band' ? billToBandId : null,
      })
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
        <span className="field__label">Bill to</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`btn btn--small ${billToType === 'client' ? 'btn--primary' : 'btn--ghost'}`}
            style={{ width: 'auto' }}
            onClick={() => handleBillToTypeChange('client')}
          >
            Client{client?.name ? ' (' + client.name + ')' : ''}
          </button>
          <button
            type="button"
            className={`btn btn--small ${billToType === 'venue' ? 'btn--primary' : 'btn--ghost'}`}
            style={{ width: 'auto', opacity: venue ? 1 : 0.5, cursor: venue ? 'pointer' : 'not-allowed' }}
            disabled={!venue}
            onClick={() => handleBillToTypeChange('venue')}
          >
            Venue{venue?.name ? ' (' + venue.name + ')' : ''}
          </button>
          <button
            type="button"
            className={`btn btn--small ${billToType === 'band' ? 'btn--primary' : 'btn--ghost'}`}
            style={{ width: 'auto' }}
            onClick={() => handleBillToTypeChange('band')}
          >
            Another band
          </button>
        </div>
        {billToType === 'band' && (
          <select value={billToBandId} onChange={(e) => setBillToBandId(e.target.value)} style={{ marginTop: 8 }}>
            <option value="">{loadingBands ? 'Loading bands…' : 'Choose a band…'}</option>
            {bandOptions.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        <span className="field__hint" style={{ display: 'block', marginTop: 4 }}>
          Who this invoice is actually addressed to — e.g. bill the venue directly for a pub gig, or another band if you were subcontracted.
        </span>
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
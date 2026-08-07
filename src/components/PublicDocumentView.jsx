import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

const RPC_BY_TYPE = {
  invoice: 'get_invoice_by_token',
  quote: 'get_quote_by_token',
  contract: 'get_contract_by_token',
};

const TITLE_BY_TYPE = {
  invoice: 'Invoice',
  quote: 'Quote',
  contract: 'Contract',
};

function poundsFromPence(pence) {
  return (pence / 100).toFixed(2);
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function docNumber(prefix, createdAt) {
  if (!createdAt) return prefix + '-00000000-000000';
  const d = new Date(createdAt);
  const pad = (n) => String(n).padStart(2, '0');
  return prefix + '-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
    '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}

// Public, no-login view for a shared invoice/quote/contract link, reached
// via /invoice/<token>, /quote/<token> or /contract/<token> (see App.jsx).
// Reads through the SECURITY DEFINER RPCs added in the theming/quotes/
// contracts migration rather than any table directly -- the anon role has
// no table grants on invoices/quotes/contracts, only EXECUTE on these
// three functions, each scoped to a single row by exact token match.
export default function PublicDocumentView({ type, token }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    supabase.rpc(RPC_BY_TYPE[type], { p_token: token }).then(({ data, error }) => {
      if (error || !data) {
        setNotFound(true);
      } else {
        setData(data);
      }
      setLoading(false);
    });
  }, [type, token]);

  if (loading) {
    return (
      <div className="enquiry-page">
        <p className="state-message">Loading…</p>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="enquiry-page">
        <div className="enquiry-card" style={{ padding: 32 }}>
          <p className="state-message state-message--error">
            This link isn't valid, or has expired.
          </p>
        </div>
      </div>
    );
  }

  const doc = data.invoice || data.quote || data.contract;
  const items = data.items || [];
  const { band, client, gig, venue } = data;
  const bandDisplayName = band?.invoice_name || band?.name;
  const prefix = type === 'invoice' ? 'INV' : type === 'quote' ? 'QUO' : 'CON';
  const number = docNumber(prefix, doc.created_at);
  const total = items.reduce((sum, i) => sum + i.unit_amount_pence * i.quantity, 0);
  const isPaid = type === 'invoice' && doc.status === 'paid';
  const isOverdue = type === 'invoice' && doc.status === 'overdue';

  return (
    <div className="enquiry-page">
      <div style={{ width: '100%', maxWidth: 720 }}>
        <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <button type="button" className="btn btn--ghost btn--small" onClick={() => window.print()}>
            Print / Save as PDF
          </button>
        </div>

        <div
          className="invoice-page-preview"
          style={{
            // Must stay a positioned ancestor (not static) -- .invoice-footer
            // is position:absolute and anchors to the nearest positioned
            // ancestor. Losing that here made it anchor to the viewport
            // instead, so it visually floated/moved while scrolling instead
            // of sitting at the bottom of the document like a normal footer.
            position: 'relative',
            width: '100%',
            minHeight: 0,
            '--doc-accent': band?.doc_accent_colour || '#c8862e',
            '--doc-secondary': band?.doc_secondary_colour || '#1f3d3a',
          }}
        >
          {(isPaid || isOverdue) && (
            <div className={'invoice-stamp invoice-stamp--' + doc.status}>
              {isPaid ? 'PAID' : 'OVERDUE'}
            </div>
          )}

          <div className="invoice-header">
            <div className="invoice-header__from">
              <h1 className="invoice-header__band">{bandDisplayName || 'Band Name'}</h1>
              {band?.address && <p className="invoice-header__address">{band.address.split('\n').join(', ')}</p>}
              {band?.contact_email && <p className="invoice-header__contact">{band.contact_email}</p>}
              {band?.contact_phone && <p className="invoice-header__contact">{band.contact_phone}</p>}
            </div>
            <div className="invoice-header__meta">
              <div className="invoice-header__label-block">
                <span className="invoice-header__label">{TITLE_BY_TYPE[type]} number</span>
                <span className="invoice-header__value">{number}</span>
              </div>
              {type !== 'contract' && (
                <div className="invoice-header__label-block">
                  <span className="invoice-header__label">Issue date</span>
                  <span className="invoice-header__value">{formatDate(doc.issued_date)}</span>
                </div>
              )}
              {type === 'invoice' && (
                <div className="invoice-header__label-block">
                  <span className="invoice-header__label">Due date</span>
                  <span className="invoice-header__value">{formatDate(doc.due_date)}</span>
                </div>
              )}
              {type === 'quote' && (
                <div className="invoice-header__label-block">
                  <span className="invoice-header__label">Valid until</span>
                  <span className="invoice-header__value">{formatDate(doc.valid_until)}</span>
                </div>
              )}
            </div>
          </div>

          <div className="invoice-divider" />

          <div className="invoice-parties">
            <div className="invoice-parties__bill-to">
              <p className="invoice-parties__heading">{type === 'contract' ? 'Between' : type === 'quote' ? 'Prepared for' : 'Bill to'}</p>
              <p className="invoice-parties__name">{client?.name || '—'}</p>
              {client?.email && <p className="invoice-parties__detail">{client.email}</p>}
              {client?.phone && <p className="invoice-parties__detail">{client.phone}</p>}
            </div>
            {gig && (
              <div className="invoice-event-box">
                <p className="invoice-event-box__heading">Event details</p>
                <p className="invoice-event-box__venue">{venue?.name || '—'}</p>
                {venue?.address && <p className="invoice-event-box__detail">{venue.address}</p>}
                <p className="invoice-event-box__detail">{formatDate(gig.gig_date)}</p>
                {gig.start_time && (
                  <p className="invoice-event-box__detail">
                    {gig.start_time.slice(0, 5)}{gig.end_time ? ' – ' + gig.end_time.slice(0, 5) : ''}
                  </p>
                )}
              </div>
            )}
          </div>

          {type !== 'contract' && (
            <>
              <table className="invoice-table">
                <thead>
                  <tr>
                    <th className="invoice-table__desc">Description</th>
                    <th className="invoice-table__qty">Qty</th>
                    <th className="invoice-table__unit">Unit price</th>
                    <th className="invoice-table__total">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, i) => (
                    <tr key={i} className={i % 2 === 0 ? 'invoice-table__row-alt' : ''}>
                      <td>{item.description}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '9pt' }}>{item.quantity}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '9pt' }}>£{poundsFromPence(item.unit_amount_pence)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '9pt' }}>£{poundsFromPence(item.unit_amount_pence * item.quantity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="invoice-totals">
                {type === 'invoice' && (
                  <div className="invoice-totals__row">
                    <span>Subtotal</span>
                    <span>£{poundsFromPence(total)}</span>
                  </div>
                )}
                {type === 'invoice' && band?.vat_number && (
                  <div className="invoice-totals__row">
                    <span>VAT (0%)</span>
                    <span>£0.00</span>
                  </div>
                )}
                <div className="invoice-totals__row invoice-totals__row--total">
                  <span>{type === 'quote' ? 'Estimated total' : 'Total due'}</span>
                  <span>£{poundsFromPence(total)}</span>
                </div>
              </div>
            </>
          )}

          {type === 'invoice' && (band?.bank_account_name || band?.bank_account_number) && (
            <div className="invoice-payment">
              <p className="invoice-payment__heading">Payment details</p>
              <div className="invoice-payment__grid">
                {band.bank_name && (<><span className="invoice-payment__label">Bank</span><span>{band.bank_name}</span></>)}
                {band.bank_account_name && (<><span className="invoice-payment__label">Account name</span><span>{band.bank_account_name}</span></>)}
                {band.bank_sort_code && (<><span className="invoice-payment__label">Sort code</span><span>{band.bank_sort_code}</span></>)}
                {band.bank_account_number && (<><span className="invoice-payment__label">Account number</span><span>{band.bank_account_number}</span></>)}
                <span className="invoice-payment__label">Reference</span>
                <span>{number}</span>
              </div>
            </div>
          )}

          {type === 'contract' && (
            <>
              <div className="invoice-payment" style={{ marginBottom: 16 }}>
                <p className="invoice-payment__heading">Terms</p>
                <div className="invoice-payment__grid">
                  <span className="invoice-payment__label">Fee</span>
                  <span>{gig?.fee_amount != null ? '£' + Number(gig.fee_amount).toFixed(2) : '—'}</span>
                  <span className="invoice-payment__label">Deposit</span>
                  <span>{doc.deposit_amount_pence != null ? '£' + poundsFromPence(doc.deposit_amount_pence) : '—'}</span>
                  <span className="invoice-payment__label">Deposit due</span>
                  <span>{formatDate(doc.deposit_due_date)}</span>
                  <span className="invoice-payment__label">Balance due</span>
                  <span>{formatDate(doc.balance_due_date)}</span>
                </div>
              </div>

              {doc.cancellation_policy && (
                <div className="invoice-footer-notes" style={{ borderTop: 'none', paddingTop: 0 }}>
                  <p style={{ fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}>Cancellation policy</p>
                  <p>{doc.cancellation_policy}</p>
                </div>
              )}
              {doc.additional_terms && (
                <div className="invoice-footer-notes" style={{ borderTop: 'none', paddingTop: 0 }}>
                  <p style={{ fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}>Additional terms</p>
                  <p>{doc.additional_terms}</p>
                </div>
              )}

              <div style={{ display: 'flex', gap: 24, marginTop: 24 }}>
                <div style={{ flex: 1 }}>
                  <p className="invoice-parties__heading">For {bandDisplayName || 'the band'}</p>
                  <p style={{ borderBottom: '1px solid var(--line)', paddingBottom: 4, minHeight: 20 }}>{doc.band_signee_name || ' '}</p>
                  <p className="field__hint" style={{ margin: '2px 0 8px' }}>Signature / name</p>
                  <p style={{ borderBottom: '1px solid var(--line)', paddingBottom: 4, minHeight: 20 }}>{doc.band_signed_date ? formatDate(doc.band_signed_date) : ' '}</p>
                  <p className="field__hint" style={{ margin: '2px 0' }}>Date</p>
                </div>
                <div style={{ flex: 1 }}>
                  <p className="invoice-parties__heading">For {client?.name || 'the client'}</p>
                  <p style={{ borderBottom: '1px solid var(--line)', paddingBottom: 4, minHeight: 20 }}>{doc.client_signee_name || ' '}</p>
                  <p className="field__hint" style={{ margin: '2px 0 8px' }}>Signature / name</p>
                  <p style={{ borderBottom: '1px solid var(--line)', paddingBottom: 4, minHeight: 20 }}>{doc.client_signed_date ? formatDate(doc.client_signed_date) : ' '}</p>
                  <p className="field__hint" style={{ margin: '2px 0' }}>Date</p>
                </div>
              </div>
            </>
          )}

          {type !== 'contract' && doc.notes && (
            <div className="invoice-footer-notes">
              <p>{doc.notes}</p>
            </div>
          )}
          {type === 'invoice' && band?.invoice_notes && (
            <div className="invoice-footer-notes">
              <p>{band.invoice_notes}</p>
            </div>
          )}

          <div className="invoice-footer">
            <span>{bandDisplayName || ''}</span>
            <span>{number}</span>
            <span>{band?.contact_email || ''}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

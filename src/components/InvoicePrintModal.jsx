import { useEffect } from 'react';

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function poundsFromPence(pence) {
  return (pence / 100).toFixed(2);
}

function invoiceNumber(shareToken) {
  if (!shareToken) return 'INV-000000';
  return 'INV-' + shareToken.replace(/-/g, '').slice(0, 8).toUpperCase();
}

export default function InvoicePrintModal({ invoice, items, gig, band, client, onClose }) {
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  const total = items.reduce((sum, i) => sum + i.unit_amount_pence * i.quantity, 0);
  const isPaid = invoice.status === 'paid';
  const isOverdue = invoice.status === 'overdue';
  const invNumber = invoiceNumber(invoice.share_token);

  const mailtoSubject = encodeURIComponent('Invoice ' + invNumber + ' — ' + (gig?.venues?.name || 'Event'));
  const mailtoBody = encodeURIComponent(
    'Please find attached invoice ' + invNumber + ' for the amount of £' + poundsFromPence(total) + '.\n\n' +
    'If you have any questions, please don\'t hesitate to get in touch.\n\n' +
    'Kind regards,\n' + (band?.name || 'The Band')
  );
  const mailtoHref = 'mailto:' + (client?.email || '') + '?subject=' + mailtoSubject + '&body=' + mailtoBody;

  return (
    <div className="print-modal-overlay">
      <div className="print-modal-toolbar no-print">
        <div className="print-modal-toolbar__left">
          <span className="print-modal-toolbar__title">{invNumber}</span>
          <span className={`status-tag status-tag--${invoice.status}`}>{invoice.status}</span>
        </div>
        <div className="print-modal-toolbar__actions">
          <span className="field__hint" style={{ marginRight: 8 }}>
            Click "Print / Save as PDF" → change destination to "Save as PDF"
          </span>
          {client?.email && (
            <a href={mailtoHref} className="btn btn--ghost btn--small" style={{ textDecoration: 'none' }}>
              ✉ Email client
            </a>
          )}
          <button className="btn btn--primary btn--small" onClick={() => window.print()}>
            Print / Save as PDF
          </button>
          <button className="btn btn--ghost btn--small" onClick={onClose}>Close</button>
        </div>
      </div>

      <div className="print-modal-scroll no-print" />

      <div className="invoice-page">

        {/* PAID / OVERDUE stamp */}
        {(isPaid || isOverdue) && (
          <div className={'invoice-stamp invoice-stamp--' + invoice.status}>
            {isPaid ? 'PAID' : 'OVERDUE'}
          </div>
        )}

        {/* Header */}
        <div className="invoice-header">
          <div className="invoice-header__from">
            <h1 className="invoice-header__band">{band?.name || 'Band Name'}</h1>
            {band?.address && (
              <p className="invoice-header__address">{band.address.split('\n').join(', ')}</p>
            )}
            {band?.contact_email && <p className="invoice-header__contact">{band.contact_email}</p>}
            {band?.contact_phone && <p className="invoice-header__contact">{band.contact_phone}</p>}
            {band?.vat_number && <p className="invoice-header__contact">VAT: {band.vat_number}</p>}
          </div>
          <div className="invoice-header__meta">
            <div className="invoice-header__label-block">
              <span className="invoice-header__label">Invoice number</span>
              <span className="invoice-header__value">{invNumber}</span>
            </div>
            <div className="invoice-header__label-block">
              <span className="invoice-header__label">Issue date</span>
              <span className="invoice-header__value">{formatDate(invoice.issued_date)}</span>
            </div>
            <div className="invoice-header__label-block">
              <span className="invoice-header__label">Due date</span>
              <span className="invoice-header__value">{formatDate(invoice.due_date)}</span>
            </div>
            {isPaid && (
              <div className="invoice-header__label-block">
                <span className="invoice-header__label">Paid date</span>
                <span className="invoice-header__value">{formatDate(invoice.paid_date)}</span>
              </div>
            )}
          </div>
        </div>

        <div className="invoice-divider" />

        {/* Bill to + Event details */}
        <div className="invoice-parties">
          <div className="invoice-parties__bill-to">
            <p className="invoice-parties__heading">Bill to</p>
            <p className="invoice-parties__name">{client?.name || '—'}</p>
            {client?.email && <p className="invoice-parties__detail">{client.email}</p>}
            {client?.phone && <p className="invoice-parties__detail">{client.phone}</p>}
          </div>
          {gig && (
            <div className="invoice-event-box">
              <p className="invoice-event-box__heading">Event details</p>
              <p className="invoice-event-box__venue">{gig.venues?.name || '—'}</p>
              {gig.venues?.address && (
                <p className="invoice-event-box__detail">{gig.venues.address}</p>
              )}
              <p className="invoice-event-box__detail">{formatDate(gig.gig_date)}</p>
              {gig.start_time && (
                <p className="invoice-event-box__detail">
                  {gig.start_time.slice(0, 5)}
                  {gig.end_time ? ' – ' + gig.end_time.slice(0, 5) : ''}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Line items */}
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
                <td>{item.quantity}</td>
                <td>£{poundsFromPence(item.unit_amount_pence)}</td>
                <td>£{poundsFromPence(item.unit_amount_pence * item.quantity)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="invoice-totals">
          <div className="invoice-totals__row">
            <span>Subtotal</span>
            <span>£{poundsFromPence(total)}</span>
          </div>
          {band?.vat_number && (
            <div className="invoice-totals__row">
              <span>VAT (0%)</span>
              <span>£0.00</span>
            </div>
          )}
          <div className="invoice-totals__row invoice-totals__row--total">
            <span>Total due</span>
            <span>£{poundsFromPence(total)}</span>
          </div>
        </div>

        {/* Payment details */}
        {(band?.bank_account_name || band?.bank_account_number) && (
          <div className="invoice-payment">
            <p className="invoice-payment__heading">Payment details</p>
            <div className="invoice-payment__grid">
              {band.bank_name && (
                <><span className="invoice-payment__label">Bank</span><span>{band.bank_name}</span></>
              )}
              {band.bank_account_name && (
                <><span className="invoice-payment__label">Account name</span><span>{band.bank_account_name}</span></>
              )}
              {band.bank_sort_code && (
                <><span className="invoice-payment__label">Sort code</span><span>{band.bank_sort_code}</span></>
              )}
              {band.bank_account_number && (
                <><span className="invoice-payment__label">Account number</span><span>{band.bank_account_number}</span></>
              )}
              <span className="invoice-payment__label">Reference</span>
              <span>{invNumber}</span>
            </div>
          </div>
        )}

        {/* Notes / terms */}
        {(invoice.notes || band?.invoice_notes) && (
          <div className="invoice-footer-notes">
            {invoice.notes && <p>{invoice.notes}</p>}
            {band?.invoice_notes && <p>{band.invoice_notes}</p>}
          </div>
        )}

        {/* Page footer */}
        <div className="invoice-footer">
          <span>{band?.name || ''}</span>
          <span>{invNumber}</span>
          <span>{band?.contact_email || ''}</span>
        </div>

      </div>
    </div>
  );
}
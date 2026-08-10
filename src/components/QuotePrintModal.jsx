import { printHtmlDocument } from '../utils/printHtml.js';
import { displayUrl } from '../utils/formatUrl.js';

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function poundsFromPence(pence) {
  return (pence / 100).toFixed(2);
}

function quoteNumber(createdAt) {
  if (!createdAt) return 'QUO-00000000-000000';
  const d = new Date(createdAt);
  const pad = (n) => String(n).padStart(2, '0');
  return 'QUO-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
    '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}

function buildPrintHTML({ quote, items, gig, band, client }) {
  const total = items.reduce((sum, i) => sum + i.unit_amount_pence * i.quantity, 0);
  const quoNumber = quoteNumber(quote.created_at);
  const bandDisplayName = band?.invoice_name || band?.name;
  const accent = band?.doc_accent_colour || '#c8862e';

  const eventBoxHTML = gig ? `
    <div class="event-box">
      <p class="label">Event details</p>
      <p class="venue-name">${gig.venues?.name || '—'}</p>
      ${gig.venues?.address ? '<p class="detail">' + gig.venues.address + '</p>' : ''}
      <p class="detail">${formatDate(gig.gig_date)}</p>
      ${gig.start_time ? '<p class="detail">' + gig.start_time.slice(0, 5) + (gig.end_time ? ' – ' + gig.end_time.slice(0, 5) : '') + '</p>' : ''}
    </div>` : '';

  const rowsHTML = items.map((item, i) => `
    <tr class="${i % 2 === 0 ? 'alt' : ''}">
      <td class="desc">${item.description}</td>
      <td class="num">${item.quantity}</td>
      <td class="num">£${poundsFromPence(item.unit_amount_pence)}</td>
      <td class="num">£${poundsFromPence(item.unit_amount_pence * item.quantity)}</td>
    </tr>`).join('');

  const footerNotesHTML = quote.notes ? `
    <div class="footer-notes">
      <p>${quote.notes}</p>
    </div>` : '';

  const socialLinksHTML = (band?.social_links || []).length > 0
    ? '<p class="from-detail">' + band.social_links.map((l) => '<a href="' + l.url + '">' + l.label + '</a>').join(' · ') + '</p>'
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>${quoNumber}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet"/>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: white; font-family: 'Inter', sans-serif; color: #1a1a1a; font-size: 10pt; }

  .page {
    width: 210mm;
    min-height: 297mm;
    padding: 18mm 16mm 28mm;
    margin: 0 auto;
    position: relative;
    overflow: hidden;
  }

  /* Header */
  .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; margin-bottom: 10mm; }
  .band-name { font-family: 'Space Grotesk', sans-serif; font-size: 22pt; font-weight: 700; color: ${accent}; margin: 0 0 5px; letter-spacing: -0.02em; }
  .band-logo { max-height: 20mm; max-width: 70mm; margin: 0 0 5px; display: block; }
  .from-detail { margin: 1px 0; font-size: 9pt; color: #555; line-height: 1.5; }
  .from-detail a { color: inherit; text-decoration: none; }
  .meta { text-align: right; flex-shrink: 0; }
  .meta-block { display: flex; flex-direction: column; align-items: flex-end; margin-bottom: 6px; }
  .meta-label { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.08em; color: #999; font-weight: 600; }
  .meta-value { font-family: 'IBM Plex Mono', monospace; font-size: 10pt; font-weight: 500; }

  /* Divider */
  .divider { height: 3px; background: linear-gradient(90deg, ${accent} 0%, color-mix(in srgb, ${accent} 65%, white) 60%, transparent 100%); border-radius: 2px; margin-bottom: 8mm; }

  /* Parties */
  .parties { display: flex; gap: 12mm; margin-bottom: 8mm; }
  .bill-to { flex: 1; }
  .label { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.08em; color: #999; font-weight: 600; margin: 0 0 4px; }
  .client-name { font-family: 'Space Grotesk', sans-serif; font-size: 14pt; font-weight: 700; margin: 0 0 3px; }
  .detail { margin: 1px 0; font-size: 9pt; color: #555; }
  .event-box { background: #f5f2ec; border-left: 3px solid ${accent}; border-radius: 4px; padding: 10px 14px; flex: 1; max-width: 80mm; }
  .venue-name { font-family: 'Space Grotesk', sans-serif; font-size: 11pt; font-weight: 700; margin: 0 0 3px; }

  /* Table */
  table { width: 100%; border-collapse: collapse; margin-bottom: 0; }
  thead tr { background: #1e1b16; }
  th { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.08em; color: #fff; padding: 7px 10px; font-weight: 600; text-align: left; }
  th.num, td.num { text-align: right; font-family: 'IBM Plex Mono', monospace; font-size: 9pt; }
  td { padding: 7px 10px; font-size: 9.5pt; border-bottom: 1px solid #eee; }
  td.desc { width: 55%; }
  tr.alt td { background: #faf8f5; }

  /* Totals */
  .totals { display: flex; flex-direction: column; align-items: flex-end; border-top: 2px solid #1e1b16; padding-top: 8px; margin-bottom: 8mm; }
  .totals-row { display: flex; gap: 32px; justify-content: flex-end; padding: 3px 10px; font-size: 9.5pt; color: #555; width: 100%; }
  .totals-row .amt { font-family: 'IBM Plex Mono', monospace; font-size: 9pt; min-width: 70px; text-align: right; }
  .totals-grand { background: ${accent}; border-radius: 4px; color: #fff; font-family: 'Space Grotesk', sans-serif; font-size: 12pt; font-weight: 700; padding: 8px 10px; margin-top: 6px; }
  .totals-grand .amt { font-family: 'Space Grotesk', sans-serif; font-size: 12pt; }

  /* Footer notes */
  .footer-notes { border-top: 1px solid #eee; padding-top: 4mm; margin-bottom: 4mm; font-size: 8.5pt; color: #777; line-height: 1.6; }
  .footer-notes p { margin: 0 0 4px; white-space: pre-line; }

  /* Page footer */
  .page-footer { position: absolute; bottom: 10mm; left: 16mm; right: 16mm; display: flex; justify-content: space-between; font-size: 7.5pt; color: #bbb; border-top: 1px solid #eee; padding-top: 4mm; }

  @page {
    size: A4;
    margin: 0;
  }
  @media print {
    html, body { margin: 0; }
    .page { margin: 0; width: 100%; padding: 10mm 12mm 20mm; }
  }
</style>
</head>
<body>
<div class="page">

  <div class="header">
    <div>
      ${band?.logo_url ? '<img class="band-logo" src="' + band.logo_url + '" alt="' + (bandDisplayName || 'Band logo') + '"/>' : '<h1 class="band-name">' + (bandDisplayName || 'Band Name') + '</h1>'}
      ${band?.address ? '<p class="from-detail">' + band.address.split('\n').join(', ') + '</p>' : ''}
      ${band?.contact_email ? '<p class="from-detail">' + band.contact_email + '</p>' : ''}
      ${band?.contact_phone ? '<p class="from-detail">' + band.contact_phone + '</p>' : ''}
      ${band?.website_url ? '<p class="from-detail"><a href="' + band.website_url + '">' + displayUrl(band.website_url) + '</a></p>' : ''}
      ${socialLinksHTML}
    </div>
    <div class="meta">
      <div class="meta-block">
        <span class="meta-label">Quote number</span>
        <span class="meta-value">${quoNumber}</span>
      </div>
      <div class="meta-block">
        <span class="meta-label">Issue date</span>
        <span class="meta-value">${formatDate(quote.issued_date)}</span>
      </div>
      <div class="meta-block">
        <span class="meta-label">Valid until</span>
        <span class="meta-value">${formatDate(quote.valid_until)}</span>
      </div>
    </div>
  </div>

  <div class="divider"></div>

  <div class="parties">
    <div class="bill-to">
      <p class="label">Prepared for</p>
      <p class="client-name">${client?.name || '—'}</p>
      ${client?.email ? '<p class="detail">' + client.email + '</p>' : ''}
      ${client?.phone ? '<p class="detail">' + client.phone + '</p>' : ''}
    </div>
    ${eventBoxHTML}
  </div>

  <table>
    <thead>
      <tr>
        <th class="desc">Description</th>
        <th class="num">Qty</th>
        <th class="num">Unit price</th>
        <th class="num">Amount</th>
      </tr>
    </thead>
    <tbody>${rowsHTML}</tbody>
  </table>

  <div class="totals">
    <div class="totals-row totals-grand">
      <span>Estimated total</span>
      <span class="amt">£${poundsFromPence(total)}</span>
    </div>
  </div>

  ${footerNotesHTML}

  <div class="page-footer">
    <span>${bandDisplayName || ''}</span>
    <span>${quoNumber}</span>
    <span>${band?.contact_email || ''}</span>
  </div>
</div>
</body>
</html>`;
}

export default function QuotePrintModal({ quote, items, gig, band, client, onClose }) {
  const total = items.reduce((sum, i) => sum + i.unit_amount_pence * i.quantity, 0);
  const quoNumber = quoteNumber(quote.created_at);
  const bandDisplayName = band?.invoice_name || band?.name;

  const mailtoSubject = encodeURIComponent('Quote ' + quoNumber + ' — ' + (gig?.venues?.name || 'Event'));
  const mailtoBody = encodeURIComponent(
    'Please find attached quote ' + quoNumber + ' for the amount of £' + poundsFromPence(total) + '.\n\n' +
    'If you have any questions, please don\'t hesitate to get in touch.\n\n' +
    'Kind regards,\n' + (band?.name || 'The Band')
  );
  const mailtoHref = 'mailto:' + (client?.email || '') + '?subject=' + mailtoSubject + '&body=' + mailtoBody;

  function handlePrint() {
    const html = buildPrintHTML({ quote, items, gig, band, client });
    printHtmlDocument(html);
  }

  return (
    <div className="print-modal-overlay">
      <div className="print-modal-toolbar">
        <div className="print-modal-toolbar__left">
          <span className="print-modal-toolbar__title">{quoNumber}</span>
          <span className={`status-tag status-tag--${quote.status}`}>{quote.status}</span>
        </div>
        <div className="print-modal-toolbar__actions">
          {client?.email && (
            <a href={mailtoHref} className="btn btn--toolbar-ghost btn--small" style={{ textDecoration: 'none' }}>
              ✉ Email client
            </a>
          )}
          <button className="btn btn--primary btn--small" onClick={handlePrint}>
            Print / Save as PDF
          </button>
          <button className="btn btn--toolbar-close btn--small" onClick={onClose}>
            ✕ Close
          </button>
        </div>
      </div>

      <div
        className="invoice-page-preview"
        style={{
          '--doc-accent': band?.doc_accent_colour || '#c8862e',
          '--doc-secondary': band?.doc_secondary_colour || '#1f3d3a',
        }}
      >
        <div className="invoice-header">
          <div className="invoice-header__from">
            {band?.logo_url ? (
              <img src={band.logo_url} alt={bandDisplayName || 'Band logo'} className="invoice-header__logo" />
            ) : (
              <h1 className="invoice-header__band">{bandDisplayName || 'Band Name'}</h1>
            )}
            {band?.address && <p className="invoice-header__address">{band.address.split('\n').join(', ')}</p>}
            {band?.contact_email && <p className="invoice-header__contact">{band.contact_email}</p>}
            {band?.contact_phone && <p className="invoice-header__contact">{band.contact_phone}</p>}
            {band?.website_url && (
              <p className="invoice-header__contact">
                <a href={band.website_url} target="_blank" rel="noopener noreferrer">{displayUrl(band.website_url)}</a>
              </p>
            )}
            {band?.social_links?.length > 0 && (
              <p className="invoice-header__contact">
                {band.social_links.map((link, i) => (
                  <span key={i}>
                    {i > 0 && ' · '}
                    <a href={link.url} target="_blank" rel="noopener noreferrer">{link.label}</a>
                  </span>
                ))}
              </p>
            )}
          </div>
          <div className="invoice-header__meta">
            {[
              ['Quote number', quoNumber],
              ['Issue date', formatDate(quote.issued_date)],
              ['Valid until', formatDate(quote.valid_until)],
            ].map(([label, value]) => (
              <div className="invoice-header__label-block" key={label}>
                <span className="invoice-header__label">{label}</span>
                <span className="invoice-header__value">{value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="invoice-divider" />

        <div className="invoice-parties">
          <div className="invoice-parties__bill-to">
            <p className="invoice-parties__heading">Prepared for</p>
            <p className="invoice-parties__name">{client?.name || '—'}</p>
            {client?.email && <p className="invoice-parties__detail">{client.email}</p>}
            {client?.phone && <p className="invoice-parties__detail">{client.phone}</p>}
          </div>
          {gig && (
            <div className="invoice-event-box">
              <p className="invoice-event-box__heading">Event details</p>
              <p className="invoice-event-box__venue">{gig.venues?.name || '—'}</p>
              {gig.venues?.address && <p className="invoice-event-box__detail">{gig.venues.address}</p>}
              <p className="invoice-event-box__detail">{formatDate(gig.gig_date)}</p>
              {gig.start_time && (
                <p className="invoice-event-box__detail">
                  {gig.start_time.slice(0, 5)}{gig.end_time ? ' – ' + gig.end_time.slice(0, 5) : ''}
                </p>
              )}
            </div>
          )}
        </div>

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
          <div className="invoice-totals__row invoice-totals__row--total">
            <span>Estimated total</span>
            <span>£{poundsFromPence(total)}</span>
          </div>
        </div>

        {quote.notes && (
          <div className="invoice-footer-notes">
            <p>{quote.notes}</p>
          </div>
        )}

        <div className="invoice-footer">
          <span>{bandDisplayName || ''}</span>
          <span>{quoNumber}</span>
          <span>{band?.contact_email || ''}</span>
        </div>
      </div>
    </div>
  );
}

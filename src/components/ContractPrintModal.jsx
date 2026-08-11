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

function contractNumber(createdAt) {
  if (!createdAt) return 'CON-00000000-000000';
  const d = new Date(createdAt);
  const pad = (n) => String(n).padStart(2, '0');
  return 'CON-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
    '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}

function signatureBlock(label, name, date, image) {
  return `
    <div class="sig-box">
      <p class="label">${label}</p>
      ${image ? '<img class="sig-image" src="' + image + '" alt="Signature"/>' : ''}
      <p class="sig-line">${name ? name : '&nbsp;'}</p>
      <p class="sig-under">Signature / name</p>
      <p class="sig-line">${date ? formatDate(date) : '&nbsp;'}</p>
      <p class="sig-under">Date</p>
    </div>`;
}

function buildPrintHTML({ contract, gig, band, client, gigFeeAmount }) {
  const conNumber = contractNumber(contract.created_at);
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

  const socialLinksHTML = (band?.social_links || []).length > 0
    ? '<p class="from-detail">' + band.social_links.map((l) => '<a href="' + l.url + '">' + l.label + '</a>').join(' · ') + '</p>'
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>${conNumber}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet"/>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: white; font-family: 'Inter', sans-serif; color: #1a1a1a; font-size: 10pt; }
  .page { width: 210mm; min-height: 297mm; padding: 18mm 16mm 28mm; margin: 0 auto; position: relative; overflow: hidden; display: flex; flex-direction: column; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; margin-bottom: 10mm; }
  .band-name { font-family: 'Space Grotesk', sans-serif; font-size: 22pt; font-weight: 700; color: ${accent}; margin: 0 0 5px; letter-spacing: -0.02em; }
  .band-logo { max-height: 20mm; max-width: 70mm; margin: 0 0 5px; display: block; }
  .from-detail { margin: 1px 0; font-size: 9pt; color: #555; line-height: 1.5; }
  .from-detail a { color: inherit; text-decoration: none; }
  .meta { text-align: right; flex-shrink: 0; }
  .meta-block { display: flex; flex-direction: column; align-items: flex-end; margin-bottom: 6px; }
  .meta-label { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.08em; color: #999; font-weight: 600; }
  .meta-value { font-family: 'IBM Plex Mono', monospace; font-size: 10pt; font-weight: 500; }
  .divider { height: 3px; background: linear-gradient(90deg, ${accent} 0%, color-mix(in srgb, ${accent} 65%, white) 60%, transparent 100%); border-radius: 2px; margin-bottom: 8mm; }
  .parties { display: flex; gap: 12mm; margin-bottom: 8mm; }
  .bill-to { flex: 1; }
  .label { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.08em; color: #999; font-weight: 600; margin: 0 0 4px; }
  .client-name { font-family: 'Space Grotesk', sans-serif; font-size: 14pt; font-weight: 700; margin: 0 0 3px; }
  .detail { margin: 1px 0; font-size: 9pt; color: #555; }
  .event-box { background: #f5f2ec; border-left: 3px solid ${accent}; border-radius: 4px; padding: 10px 14px; flex: 1; max-width: 80mm; }
  .venue-name { font-family: 'Space Grotesk', sans-serif; font-size: 11pt; font-weight: 700; margin: 0 0 3px; }
  .terms-grid { display: grid; grid-template-columns: 130px 1fr; gap: 4px 12px; font-size: 9.5pt; margin-bottom: 8mm; }
  .terms-grid .pl { color: #888; font-weight: 600; }
  .section { margin-bottom: 6mm; }
  .section p.body { margin: 0; font-size: 9pt; color: #444; line-height: 1.6; white-space: pre-line; }
  .sig-row { display: flex; gap: 16mm; margin-top: 12mm; }
  .sig-box { flex: 1; }
  .sig-box .label { margin-bottom: 12mm; }
  .sig-line { border-bottom: 1px solid #999; padding-bottom: 4px; margin: 0 0 2px; font-size: 10pt; min-height: 14pt; }
  .sig-image { max-height: 18mm; max-width: 100%; display: block; margin-bottom: 2px; }
  .sig-under { font-size: 7.5pt; color: #999; margin: 0; }
  .page-footer { margin-top: auto; display: flex; justify-content: space-between; font-size: 7.5pt; color: #bbb; border-top: 1px solid #eee; padding-top: 4mm; }
  @page {
    size: A4;
    margin: 0;
  }
  @media print {
    html, body { margin: 0; }
    * { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    .page { margin: 0; width: 100%; min-height: 0; padding: 10mm 12mm 20mm; }
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
        <span class="meta-label">Contract number</span>
        <span class="meta-value">${conNumber}</span>
      </div>
    </div>
  </div>

  <div class="divider"></div>

  <div class="parties">
    <div class="bill-to">
      <p class="label">Between</p>
      <p class="client-name">${client?.name || '—'}</p>
      ${client?.email ? '<p class="detail">' + client.email + '</p>' : ''}
      ${client?.phone ? '<p class="detail">' + client.phone + '</p>' : ''}
    </div>
    ${eventBoxHTML}
  </div>

  <div class="terms-grid">
    <span class="pl">Fee</span><span>${gigFeeAmount != null ? '£' + Number(gigFeeAmount).toFixed(2) : '—'}</span>
    <span class="pl">Deposit</span><span>${contract.deposit_amount_pence != null ? '£' + poundsFromPence(contract.deposit_amount_pence) : '—'}</span>
    <span class="pl">Deposit due</span><span>${formatDate(contract.deposit_due_date)}</span>
    <span class="pl">Balance due</span><span>${formatDate(contract.balance_due_date)}</span>
  </div>

  ${contract.cancellation_policy ? `<div class="section"><p class="label">Cancellation policy</p><p class="body">${contract.cancellation_policy}</p></div>` : ''}
  ${contract.additional_terms ? `<div class="section"><p class="label">Additional terms</p><p class="body">${contract.additional_terms}</p></div>` : ''}

  <div class="sig-row">
    ${signatureBlock('For ' + (bandDisplayName || 'the band'), contract.band_signee_name, contract.band_signed_date, contract.band_signature_image)}
    ${signatureBlock('For ' + (client?.name || 'the client'), contract.client_signee_name, contract.client_signed_date, contract.client_signature_image)}
  </div>

  <div class="page-footer">
    <span>${bandDisplayName || ''}</span>
    <span>${conNumber}</span>
    <span>${band?.contact_email || ''}</span>
  </div>
</div>
</body>
</html>`;
}

export default function ContractPrintModal({ contract, gig, band, client, gigFeeAmount, onClose }) {
  const conNumber = contractNumber(contract.created_at);
  const bandDisplayName = band?.invoice_name || band?.name;

  const mailtoSubject = encodeURIComponent('Contract ' + conNumber + ' — ' + (gig?.venues?.name || 'Event'));
  const mailtoBody = encodeURIComponent(
    'Please find attached your booking contract ' + conNumber + '.\n\n' +
    'If you have any questions, please don\'t hesitate to get in touch.\n\n' +
    'Kind regards,\n' + (band?.name || 'The Band')
  );
  const mailtoHref = 'mailto:' + (client?.email || '') + '?subject=' + mailtoSubject + '&body=' + mailtoBody;

  function handlePrint() {
    const html = buildPrintHTML({ contract, gig, band, client, gigFeeAmount });
    printHtmlDocument(html);
  }

  return (
    <div className="print-modal-overlay">
      <div className="print-modal-toolbar">
        <div className="print-modal-toolbar__left">
          <span className="print-modal-toolbar__title">{conNumber}</span>
          <span className={`status-tag status-tag--${contract.status}`}>{contract.status}</span>
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
            <div className="invoice-header__label-block">
              <span className="invoice-header__label">Contract number</span>
              <span className="invoice-header__value">{conNumber}</span>
            </div>
          </div>
        </div>

        <div className="invoice-divider" />

        <div className="invoice-parties">
          <div className="invoice-parties__bill-to">
            <p className="invoice-parties__heading">Between</p>
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

        <div className="invoice-payment" style={{ marginBottom: 16 }}>
          <p className="invoice-payment__heading">Terms</p>
          <div className="invoice-payment__grid">
            <span className="invoice-payment__label">Fee</span>
            <span>{gigFeeAmount != null ? '£' + Number(gigFeeAmount).toFixed(2) : '—'}</span>
            <span className="invoice-payment__label">Deposit</span>
            <span>{contract.deposit_amount_pence != null ? '£' + poundsFromPence(contract.deposit_amount_pence) : '—'}</span>
            <span className="invoice-payment__label">Deposit due</span>
            <span>{formatDate(contract.deposit_due_date)}</span>
            <span className="invoice-payment__label">Balance due</span>
            <span>{formatDate(contract.balance_due_date)}</span>
          </div>
        </div>

        {contract.cancellation_policy && (
          <div className="invoice-footer-notes" style={{ borderTop: 'none', paddingTop: 0 }}>
            <p style={{ fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}>Cancellation policy</p>
            <p>{contract.cancellation_policy}</p>
          </div>
        )}

        {contract.additional_terms && (
          <div className="invoice-footer-notes" style={{ borderTop: 'none', paddingTop: 0 }}>
            <p style={{ fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}>Additional terms</p>
            <p>{contract.additional_terms}</p>
          </div>
        )}

        <div style={{ display: 'flex', gap: 24, marginTop: 24 }}>
          <div style={{ flex: 1 }}>
            <p className="invoice-parties__heading">For {bandDisplayName || 'the band'}</p>
            {contract.band_signature_image && (
              <img src={contract.band_signature_image} alt="Signature" style={{ maxHeight: 60, display: 'block', marginBottom: 2 }} />
            )}
            <p style={{ borderBottom: '1px solid var(--line)', paddingBottom: 4, minHeight: 20 }}>{contract.band_signee_name || ' '}</p>
            <p className="field__hint" style={{ margin: '2px 0 8px' }}>Signature / name</p>
            <p style={{ borderBottom: '1px solid var(--line)', paddingBottom: 4, minHeight: 20 }}>{contract.band_signed_date ? formatDate(contract.band_signed_date) : ' '}</p>
            <p className="field__hint" style={{ margin: '2px 0' }}>Date</p>
          </div>
          <div style={{ flex: 1 }}>
            <p className="invoice-parties__heading">For {client?.name || 'the client'}</p>
            {contract.client_signature_image && (
              <img src={contract.client_signature_image} alt="Signature" style={{ maxHeight: 60, display: 'block', marginBottom: 2 }} />
            )}
            <p style={{ borderBottom: '1px solid var(--line)', paddingBottom: 4, minHeight: 20 }}>{contract.client_signee_name || ' '}</p>
            <p className="field__hint" style={{ margin: '2px 0 8px' }}>Signature / name</p>
            <p style={{ borderBottom: '1px solid var(--line)', paddingBottom: 4, minHeight: 20 }}>{contract.client_signed_date ? formatDate(contract.client_signed_date) : ' '}</p>
            <p className="field__hint" style={{ margin: '2px 0' }}>Date</p>
          </div>
        </div>

        <div className="invoice-footer">
          <span>{bandDisplayName || ''}</span>
          <span>{conNumber}</span>
          <span>{band?.contact_email || ''}</span>
        </div>
      </div>
    </div>
  );
}

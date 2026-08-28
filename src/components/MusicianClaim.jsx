import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useCurrentProfile } from '../context/ProfileContext.jsx';
import { ReceiptLineAttach } from './ReceiptCapture.jsx';
import { printHtmlDocument, esc, fontFaceCss } from '../utils/printHtml.js';
import { CLAIM_CATEGORIES } from '../utils/claimCategories.js';
import NumberInput from './NumberInput.jsx';

function poundsFromPence(p) {
  return (p / 100).toFixed(2);
}

function sortedItems(claim) {
  return [...(claim?.musician_claim_items || [])].sort((a, b) => a.sort_order - b.sort_order);
}

function claimTotalPence(claim) {
  return sortedItems(claim).reduce((sum, i) => sum + i.amount_pence, 0);
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function claimInvoiceNumber(createdAt) {
  if (!createdAt) return 'CLAIM-00000000-000000';
  const d = new Date(createdAt);
  const pad = (n) => String(n).padStart(2, '0');
  return 'CLAIM-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
    '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}

const STATUS_LABELS = {
  pending: 'Awaiting admin review',
  approved: 'Approved — payment coming',
  paid: 'Paid',
  rejected: 'Rejected',
};

const STATUS_COLORS = {
  pending: 'inquiry',
  approved: 'confirmed',
  paid: 'completed',
  rejected: 'cancelled',
};

// -------------------------------------------------------------------
// 1. New Smart Email Button Component
// -------------------------------------------------------------------
function ClaimEmailButton({ band, claim, profile, onDownloadPdf, claimInvoiceNumber, poundsFromPence }) {
  const [step, setStep] = useState(1);
  const [copied, setCopied] = useState(false);

  const emailTo = band?.contact_email || '';
  const invNumber = claimInvoiceNumber(claim?.created_at);
  const amount = poundsFromPence(claimTotalPence(claim));
  const musicianName = profile?.full_name || profile?.name || 'Musician';

  const subject = `Invoice ${invNumber} - ${musicianName}`;
  const body = `Hi ${band?.name || 'Team'},\n\n` +
    `Please find my invoice PDF attached for the gig.\n\n` +
    `• Invoice Ref: ${invNumber}\n` +
    `• Total Claimed: £${amount}\n\n` +
    `My payment details are listed on the attached document.\n\n` +
    `Best regards,\n` +
    `${musicianName}`;

  const fullClipboardText = `To: ${emailTo}\nSubject: ${subject}\n\n${body}`;
  const mailtoUrl = `mailto:${emailTo}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  if (!emailTo) {
    return (
      <button className="btn btn--ghost btn--small" onClick={onDownloadPdf}>
        Download invoice
      </button>
    );
  }

  const handleGeneratePdf = async () => {
    // 1. Silently copy everything to clipboard first (Crucial for iOS Share Sheet users)
    try {
      await navigator.clipboard.writeText(fullClipboardText);
    } catch (e) {
      console.log("Clipboard write blocked, user will have to use the copy button.");
    }

    // 2. Trigger the PDF print/download window
    await onDownloadPdf();
    
    // 3. Move to Step 2 so the UI updates when they return from the print dialog
    setStep(2);
  };

  const handleOpenEmailDraft = () => {
    window.open(mailtoUrl, '_blank', 'noopener,noreferrer');
  };

  const handleCopyText = async (e) => {
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(fullClipboardText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '12px', padding: '16px', backgroundColor: '#f9f9f9', border: '1px solid #eee', borderRadius: '6px' }}>
      {step === 1 ? (
        <>
          <p style={{ margin: 0, fontWeight: 500 }}>Step 1: Save your invoice</p>
          <button
            onClick={handleGeneratePdf}
            className="btn btn--primary btn--small"
            style={{ alignSelf: 'flex-start' }}
          >
            📥 Generate & Save PDF
          </button>
        </>
      ) : (
        <>
          <p style={{ margin: 0, fontWeight: 500, color: '#2e7d32' }}>✓ PDF Generated!</p>
          <p style={{ margin: 0, fontSize: '0.9em', color: '#555' }}>
            <strong>Step 2: Email the band.</strong> Web browsers can't auto-attach files. Open a draft below and manually attach your saved PDF.
          </p>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '4px' }}>
            <button onClick={handleOpenEmailDraft} className="btn btn--primary btn--small">
              ✉️ Open Email Draft
            </button>
            <button type="button" className="btn btn--ghost btn--small" onClick={handleCopyText}>
              {copied ? '✓ Copied Details!' : '📋 Copy Email Details'}
            </button>
          </div>
          <p style={{ margin: 0, fontSize: '0.85em', color: '#888', fontStyle: 'italic' }}>
            📱 <strong>iPhone users:</strong> If you used the "Share" menu to open Mail, just hit "Paste" — we already copied the To, Subject, and Body for you!
          </p>
        </>
      )}
    </div>
  );
}

// -------------------------------------------------------------------
// 2. Invoice HTML builder — musician issues this TO the band
// -------------------------------------------------------------------
function buildMusicianInvoiceHTML({ claim, gig, band, profile }) {
  const invNumber = claimInvoiceNumber(claim.created_at);
  const isPaid = claim.status === 'paid';
  const items = sortedItems(claim);
  const total = claimTotalPence(claim);

  const issuedDate = claim.created_at ? claim.created_at.slice(0, 10) : null;
  const paidDate   = isPaid && claim.updated_at ? claim.updated_at.slice(0, 10) : null;

  const musicianName  = profile?.full_name || profile?.name || 'Musician';
  const musicianPhone  = profile?.phone || '';
  const musicianEmail = profile?.email || '';

  const stampHTML = isPaid
    ? '<div class="stamp stamp--paid">PAID</div>'
    : '';

  const eventBoxHTML = gig ? `
    <div class="event-box">
      <p class="label">Event details</p>
      <p class="venue-name">${esc(gig.venues?.name || '—')}</p>
      ${gig.venues?.address ? '<p class="detail">' + esc(gig.venues.address) + '</p>' : ''}
      <p class="detail">${formatDate(gig.gig_date)}</p>
      ${gig.start_time ? `<p class="detail">${esc(gig.start_time.slice(0, 5))}${gig.end_time ? ' – ' + esc(gig.end_time.slice(0, 5)) : ''}</p>` : ''}
    </div>` : '';

  const paymentHTML = (profile?.bank_account_name || profile?.bank_account_number) ? `
    <div class="payment-box">
      <p class="label">Payment details</p>
      <div class="payment-grid">
        ${profile.bank_name           ? `<span class="pl">Bank</span><span>${esc(profile.bank_name)}</span>` : ''}
        ${profile.bank_account_name   ? `<span class="pl">Account name</span><span>${esc(profile.bank_account_name)}</span>` : ''}
        ${profile.bank_sort_code      ? `<span class="pl">Sort code</span><span>${esc(profile.bank_sort_code)}</span>` : ''}
        ${profile.bank_account_number ? `<span class="pl">Account number</span><span>${esc(profile.bank_account_number)}</span>` : ''}
        <span class="pl">Reference</span><span>${esc(invNumber)}</span>
      </div>
    </div>` : '';

  const notesHTML = claim.notes ? `
    <div class="footer-notes">
      <p>${esc(claim.notes)}</p>
    </div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>${invNumber}</title>
<style>
  ${fontFaceCss()}
  *, *::before, *::after { box-sizing: border-box; }
  
  html, body { 
    margin: 0; 
    padding: 0; 
    background: white; 
    font-family: 'Inter', sans-serif; 
    color: #1a1a1a; 
    font-size: 10pt; 
  }
  
  .page { 
    width: 210mm; 
    height: 297mm;          
    max-height: 297mm;      
    padding: 15mm 15mm 25mm; 
    margin: 0 auto; 
    position: relative; 
    overflow: hidden;       
    box-sizing: border-box;
  }

  .stamp { position: absolute; top: 38mm; right: 14mm; font-family: 'Space Grotesk', sans-serif; font-size: 34pt; font-weight: 700; letter-spacing: 0.1em; transform: rotate(-22deg); opacity: 0.1; border: 6px solid; padding: 4px 12px; border-radius: 4px; pointer-events: none; }
  .stamp--paid { color: #1f3d3a; border-color: #1f3d3a; }

  .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; margin-bottom: 6mm; }
  .musician-name { font-family: 'Space Grotesk', sans-serif; font-size: 22pt; font-weight: 700; color: #c8862e; margin: 0 0 5px; letter-spacing: -0.02em; }
  .from-detail { margin: 1px 0; font-size: 9pt; color: #555; line-height: 1.5; }
  .meta { text-align: right; flex-shrink: 0; }
  .meta-block { display: flex; flex-direction: column; align-items: flex-end; margin-bottom: 6px; }
  .meta-label { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.08em; color: #999; font-weight: 600; }
  .meta-value { font-family: 'IBM Plex Mono', monospace; font-size: 10pt; font-weight: 500; }

  .divider { height: 3px; background: linear-gradient(90deg, #c8862e 0%, #e8a84e 60%, transparent 100%); border-radius: 2px; margin-bottom: 6mm; }

  .parties { display: flex; gap: 12mm; margin-bottom: 6mm; }
  .bill-to { flex: 1; }
  .label { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.08em; color: #999; font-weight: 600; margin: 0 0 4px; }
  .client-name { font-family: 'Space Grotesk', sans-serif; font-size: 14pt; font-weight: 700; margin: 0 0 3px; }
  .detail { margin: 1px 0; font-size: 9pt; color: #555; }
  .event-box { background: #f5f2ec; border-left: 3px solid #c8862e; border-radius: 4px; padding: 10px 14px; flex: 1; max-width: 80mm; }
  .venue-name { font-family: 'Space Grotesk', sans-serif; font-size: 11pt; font-weight: 700; margin: 0 0 3px; }

  table { width: 100%; border-collapse: collapse; margin-bottom: 0; }
  thead tr { background: #1e1b16; }
  th { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.08em; color: #fff; padding: 7px 10px; font-weight: 600; text-align: left; }
  th.num, td.num { text-align: right; font-family: 'IBM Plex Mono', monospace; font-size: 9pt; }
  td { padding: 7px 10px; font-size: 9.5pt; border-bottom: 1px solid #eee; }
  td.desc { width: 55%; }
  tr.alt td { background: #faf8f5; }

  .totals { display: flex; flex-direction: column; align-items: flex-end; border-top: 2px solid #1e1b16; padding-top: 8px; margin-bottom: 6mm; }
  .totals-row { display: flex; gap: 32px; justify-content: flex-end; padding: 3px 10px; font-size: 9.5pt; color: #555; width: 100%; }
  .totals-row .amt { font-family: 'IBM Plex Mono', monospace; font-size: 9pt; min-width: 70px; text-align: right; }
  .totals-grand { background: #c8862e; border-radius: 4px; color: #fff; font-family: 'Space Grotesk', sans-serif; font-size: 12pt; font-weight: 700; padding: 8px 10px; margin-top: 6px; }
  .totals-grand .amt { font-family: 'Space Grotesk', sans-serif; font-size: 12pt; }

  .payment-box { background: #f5f2ec; border-radius: 6px; padding: 10px 14px; margin-bottom: 4mm; }
  .payment-grid { display: grid; grid-template-columns: 130px 1fr; gap: 4px 12px; font-size: 9.5pt; }
  .pl { color: #888; font-weight: 600; }

  .footer-notes { border-top: 1px solid #eee; padding-top: 3mm; margin-bottom: 3mm; font-size: 8.5pt; color: #777; line-height: 1.5; }
  .footer-notes p { margin: 0 0 4px; white-space: pre-line; }

  .page-footer { position: absolute; bottom: 8mm; left: 15mm; right: 15mm; display: flex; justify-content: space-between; font-size: 7.5pt; color: #bbb; border-top: 1px solid #eee; padding-top: 4mm; }

  @media print {
    @page {
      size: A4 portrait;
      margin: 0; 
    }

    html, body {
      height: 99% !important; 
      margin: 0 !important;
      padding: 0 !important;
    }

    .page {
      width: 210mm !important;
      height: 272mm !important; 
      padding: 15mm 15mm 15mm !important; 
      page-break-inside: avoid !important;
      break-inside: avoid !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  }
</style>
</head>
<body>
<div class="page">
  ${stampHTML}

  <div class="header">
    <div>
      <h1 class="musician-name">${musicianName}</h1>
      ${musicianPhone ? `<p class="from-detail">${musicianPhone}</p>` : ''}
      ${musicianEmail ? `<p class="from-detail">${musicianEmail}</p>` : ''}
    </div>
    <div class="meta">
      <div class="meta-block">
        <span class="meta-label">Claim reference</span>
        <span class="meta-value">${invNumber}</span>
      </div>
      <div class="meta-block">
        <span class="meta-label">Date submitted</span>
        <span class="meta-value">${formatDate(issuedDate)}</span>
      </div>
      </div>
  </div>

  <div class="divider"></div>

  <div class="parties">
    <div class="bill-to">
      <p class="label">Invoice To</p>
      <p class="client-name">${esc(band?.invoice_name || band?.name || '—')}</p>
      ${band?.address ? `<p class="detail">${esc(band.address)}</p>` : ''}
      ${band?.contact_email ? `<p class="detail">${esc(band.contact_email)}</p>` : ''}
      ${band?.contact_phone ? `<p class="detail">${esc(band.contact_phone)}</p>` : ''}
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
    <tbody>
      ${items.map((item, i) => `
      <tr class="${i % 2 === 1 ? 'alt' : ''}">
        <td class="desc">${esc(item.description)}<br/><span style="color:#999;font-size:7.5pt;text-transform:uppercase;letter-spacing:0.05em;">${esc(item.category)}</span></td>
        <td class="num">1</td>
        <td class="num">£${poundsFromPence(item.amount_pence)}</td>
        <td class="num">£${poundsFromPence(item.amount_pence)}</td>
      </tr>`).join('')}
    </tbody>
  </table>

  <div class="totals">
    <div class="totals-row">
      <span>Subtotal</span>
      <span class="amt">£${poundsFromPence(total)}</span>
    </div>
    <div class="totals-row totals-grand">
      <span>Total claimed</span>
      <span class="amt">£${poundsFromPence(total)}</span>
    </div>
  </div>

  ${paymentHTML}
  ${notesHTML}

  <div class="page-footer">
    <span>${musicianName}</span>
    <span>${invNumber}</span>
    <span>${musicianEmail}</span>
  </div>
</div>
<!-- Auto-close script: Closes the popup as soon as the print dialog finishes -->
<script>
  window.addEventListener('afterprint', () => {
    setTimeout(() => window.close(), 100);
  });
</script>
</body>
</html>`;
}

// -------------------------------------------------------------------
// 3. Main component
// -------------------------------------------------------------------
export default function MusicianClaim({ gigId, myProfileId, refreshSignal }) {
  const { isPro } = useCurrentProfile();
  const [claim, setClaim]       = useState(null);
  const [myLineup, setMyLineup] = useState(null);
  const [gig, setGig]           = useState(null);
  const [band, setBand]         = useState(null);
  const [profile, setProfile]   = useState(null);
  const [loading, setLoading]   = useState(true);
  const [editing, setEditing]   = useState(false);
  const [items, setItems]       = useState([]);
  const [notes, setNotes]       = useState('');
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState(null);

  const load = useCallback(async () => {
    setLoading(true);

    const [
      { data: claimData },
      { data: lineupData },
      { data: gigData },
      { data: profileData },
      authResult,
    ] = await Promise.all([
      supabase.from('musician_claims').select('*, musician_claim_items(*)').eq('gig_id', gigId).eq('profile_id', myProfileId).maybeSingle(),
      supabase.from('gig_lineup').select('fee_pence, travel_cost_pence, instrument_id, instruments(name)').eq('gig_id', gigId).eq('profile_id', myProfileId).maybeSingle(),
      supabase.from('gigs').select('gig_date, start_time, end_time, band_id, venues(name, address)').eq('id', gigId).maybeSingle(),
      // Bank columns aren't directly selectable (see
      // 20260826130000_restrict_sensitive_profile_columns.sql) -- this RPC
      // checks the caller itself rather than relying on RLS row access,
      // since "can see this row" no longer means "can see every column".
      supabase.rpc('get_payment_details', { p_profile_id: myProfileId }).maybeSingle(),
      supabase.auth.getUser(),
    ]);

    const authEmail = authResult?.data?.user?.email || '';

    setClaim(claimData);
    setMyLineup(lineupData);
    setGig(gigData);
    setProfile({ ...profileData, email: authEmail });

    if (gigData?.band_id) {
      const { data: bandData } = await supabase
        .from('bands')
        .select('name, invoice_name, contact_email, contact_phone, address')
        .eq('id', gigData.band_id)
        .maybeSingle();
      setBand(bandData);
    }

    setLoading(false);
  }, [gigId, myProfileId]);

  useEffect(() => {
    load();
    // refreshSignal is otherwise unused here -- it's a signal, not data. The
    // top "↻ Refresh" button in GigDetailBandMember bumps it specifically to
    // give this effect a reason to re-run too, e.g. picking up a fee an admin
    // just set without needing to leave and reopen. Safe to fire mid-edit --
    // load() never touches `items`/`notes`, only the read-only fields above
    // the edit form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, refreshSignal]);

  function handlePrintInvoice() {
    if (!claim) return;
    const html = buildMusicianInvoiceHTML({ claim, gig, band, profile });
    printHtmlDocument(html);
  }

  // A new claim starts pre-seeded with a Fee line and, if travel was already
  // calculated for this gig, a separate Travel line for it -- fee and travel
  // are different tax categories for the musician's own records, so they
  // shouldn't be forced into one lump amount the way a single-field claim
  // used to require.
  function startCreate() {
    const newItems = [
      {
        category: 'Fee',
        description: 'Performance fee' + (myLineup?.instruments?.name ? ' — ' + myLineup.instruments.name : ''),
        amountPounds: myLineup?.fee_pence ? (myLineup.fee_pence / 100).toFixed(2) : '',
      },
    ];
    if (myLineup?.travel_cost_pence) {
      newItems.push({
        category: 'Travel / mileage',
        description: 'Travel',
        amountPounds: (myLineup.travel_cost_pence / 100).toFixed(2),
      });
    }
    setItems(newItems);
    setNotes('');
    setEditing(true);
    setError(null);
  }

  function startEdit() {
    setItems(
      sortedItems(claim).map((i) => ({
        category: i.category,
        description: i.description,
        amountPounds: (i.amount_pence / 100).toFixed(2),
        // Carried through the round trip on purpose: update_musician_claim
        // deletes and re-inserts every item, so dropping this here would
        // silently detach the receipt on any edit.
        receipt_id: i.receipt_id || null,
      }))
    );
    setNotes(claim.notes || '');
    setEditing(true);
    setError(null);
  }

  function updateItem(index, patch) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }

  function addItem() {
    setItems((prev) => [...prev, { category: CLAIM_CATEGORIES[0], description: '', amountPounds: '' }]);
  }

  function removeItem(index) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  const draftTotalPence = items.reduce((sum, it) => {
    const p = Math.round(Number(it.amountPounds) * 100);
    return sum + (Number.isFinite(p) && p > 0 ? p : 0);
  }, 0);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    if (items.length === 0) {
      setError('Add at least one line.');
      setSaving(false);
      return;
    }

    const parsedItems = [];
    for (const it of items) {
      if (!it.description.trim()) {
        setError('Every line needs a description.');
        setSaving(false);
        return;
      }
      const amountPence = Math.round(Number(it.amountPounds) * 100);
      if (!amountPence || amountPence <= 0) {
        setError('Every line needs a valid amount.');
        setSaving(false);
        return;
      }
      parsedItems.push({
        category: it.category,
        description: it.description.trim(),
        amount_pence: amountPence,
        receipt_id: it.receipt_id || null,
      });
    }

    // A single RPC call (one transaction) rather than a header insert/update
    // followed by a separate items insert -- notify-admin/notify-musician
    // fire the instant the header row commits, and reading
    // musician_claim_items in a still-separate follow-up request raced that
    // webhook, showing "£0.00" when it fired before the items existed yet.
    const claimId = claim?.id;
    const { error: rpcError } = claimId
      ? await supabase.rpc('update_musician_claim', { p_claim_id: claimId, p_notes: notes || null, p_items: parsedItems })
      : await supabase.rpc('create_musician_claim', { p_gig_id: gigId, p_notes: notes || null, p_items: parsedItems });
    if (rpcError) {
      // Raised by create_musician_claim/update_musician_claim's own Pro
      // check when this is reached directly rather than via the (already
      // hidden, for a free-tier musician) submit button -- strip the
      // machine-readable prefix so the message reads cleanly.
      const message = rpcError.message?.startsWith('PRO_REQUIRED: ')
        ? rpcError.message.slice('PRO_REQUIRED: '.length)
        : rpcError.message;
      setError(message);
      setSaving(false);
      return;
    }

    setSaving(false);
    setEditing(false);
    load();

    // Notify the gig list so it re-fetches claim_status for this gig,
    // keeping the "Unpaid claims" filter in sync without a manual reload.
    window.dispatchEvent(new CustomEvent('claim-updated', { detail: { gig_id: gigId } }));
  }

  if (loading) return null;

  const canDownloadInvoice = claim && (claim.status === 'approved' || claim.status === 'paid' || claim.status === 'pending');

  return (
    <div className="day-sheet__section">
      <h3 className="day-sheet__section-title">My payment claim</h3>

      {!claim && !editing && (
        <>
          {myLineup?.travel_cost_pence > 0 && (
            <p className="field__hint">
              Your calculated travel cost is £{poundsFromPence(myLineup.travel_cost_pence)} — this
              will be added as its own line when you start a claim.
            </p>
          )}
          {isPro ? (
            <button
              className="btn btn--primary btn--small"
              style={{ marginTop: 8 }}
              onClick={startCreate}
            >
              Submit a claim for this gig
            </button>
          ) : (
            <p className="field__hint" style={{ marginTop: 8 }}>Claims are a Pro feature — upgrade in My Profile to submit one.</p>
          )}
        </>
      )}

      {claim && !editing && (
        <>
          <div className="claim-card">
            {sortedItems(claim).map((item) => (
              <div className="claim-card__row" key={item.id}>
                <span className="claim-card__label">{item.category}</span>
                <span>{item.description} — <strong>£{poundsFromPence(item.amount_pence)}</strong></span>
              </div>
            ))}
            <div className="claim-card__row">
              <span className="claim-card__label">Total</span>
              <span className="claim-card__amount">£{poundsFromPence(claimTotalPence(claim))}</span>
            </div>
            {claim.notes && (
              <div className="claim-card__row">
                <span className="claim-card__label">Notes</span>
                <span>{claim.notes}</span>
              </div>
            )}
            <div className="claim-card__row">
              <span className="claim-card__label">Status</span>
              <span className={'status-tag status-tag--' + STATUS_COLORS[claim.status]}>
                {STATUS_LABELS[claim.status]}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {isPro && (claim.status === 'pending' || claim.status === 'rejected') && (
              <button
                className="link-button"
                style={{ marginTop: '12px' }}
                onClick={startEdit}
              >
                {claim.status === 'rejected' ? 'Amend & resubmit' : 'Edit claim'}
              </button>
            )}
            {canDownloadInvoice && (
              <ClaimEmailButton
                band={band}
                claim={claim}
                profile={profile}
                onDownloadPdf={handlePrintInvoice}
                claimInvoiceNumber={claimInvoiceNumber}
                poundsFromPence={poundsFromPence}
              />
            )}
          </div>
        </>
      )}

      {editing && (
        <form className="inline-subform" onSubmit={handleSubmit}>
          {items.map((item, i) => (
            <div
              key={i}
              style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 10 }}
            >
              <label className="field" style={{ flex: '1 1 150px', marginBottom: 0 }}>
                <span className="field__label">Category</span>
                <select value={item.category} onChange={(e) => updateItem(i, { category: e.target.value })}>
                  {CLAIM_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label className="field" style={{ flex: '2 1 200px', marginBottom: 0 }}>
                <span className="field__label">Description</span>
                <input value={item.description} onChange={(e) => updateItem(i, { description: e.target.value })} required />
              </label>
              <label className="field" style={{ flex: '0 1 110px', marginBottom: 0 }}>
                <span className="field__label">Amount (£)</span>
                <NumberInput
                  decimals={2}
                  min={0}
                  prefix="£"
                  value={item.amountPounds}
                  onChange={(e) => updateItem(i, { amountPounds: e.target.value })}
                  placeholder="0.00"
                  required
                />
              </label>
              {isPro && (
                <ReceiptLineAttach
                  profileId={myProfileId}
                  attached={Boolean(item.receipt_id)}
                  onExtracted={(patch) => updateItem(i, {
                    receipt_id: patch.receipt_id,
                    // Only fill blanks -- never overwrite something the
                    // musician has already typed on this line.
                    description: item.description || patch.description,
                    amountPounds: item.amountPounds || patch.amountPounds,
                  })}
                  onError={setError}
                />
              )}
              <button
                type="button"
                className="link-button link-button--danger"
                style={{ marginBottom: 10 }}
                onClick={() => removeItem(i)}
                aria-label="Remove line"
              >
                Remove
              </button>
            </div>
          ))}

          <button type="button" className="btn btn--ghost btn--small" onClick={addItem} style={{ marginBottom: 12 }}>
            + Add line
          </button>

          <p style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
            Total: <strong style={{ color: 'var(--ink)' }}>£{poundsFromPence(draftTotalPence)}</strong>
          </p>

          <label className="field">
            <span className="field__label">Notes (optional)</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
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
              {saving ? 'Saving…' : claim ? 'Update claim' : 'Submit claim'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
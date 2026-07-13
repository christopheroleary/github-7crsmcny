import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';

function poundsFromPence(p) {
  return (p / 100).toFixed(2);
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function claimInvoiceNumber(claimId) {
  if (!claimId) return 'CLAIM-000000';
  return 'CLAIM-' + String(claimId).padStart(6, '0');
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
// Invoice HTML builder — musician issues this TO the band
// -------------------------------------------------------------------
function buildMusicianInvoiceHTML({ claim, gig, band, profile }) {
  const invNumber = claimInvoiceNumber(claim.id);
  const isPaid = claim.status === 'paid';
  const total = claim.amount_pence;

  // Use created_at as "issued date"; use updated_at as "paid date" if paid
  const issuedDate = claim.created_at ? claim.created_at.slice(0, 10) : null;
  const paidDate   = isPaid && claim.updated_at ? claim.updated_at.slice(0, 10) : null;

  const musicianName  = profile?.full_name || profile?.name || 'Musician';
  const musicianEmail = profile?.email || '';

  const stampHTML = isPaid
    ? '<div class="stamp stamp--paid">PAID</div>'
    : '';

  const eventBoxHTML = gig ? `
    <div class="event-box">
      <p class="label">Event details</p>
      <p class="venue-name">${gig.venues?.name || '—'}</p>
      ${gig.venues?.address ? '<p class="detail">' + gig.venues.address + '</p>' : ''}
      <p class="detail">${formatDate(gig.gig_date)}</p>
      ${gig.start_time ? `<p class="detail">${gig.start_time.slice(0, 5)}${gig.end_time ? ' – ' + gig.end_time.slice(0, 5) : ''}</p>` : ''}
    </div>` : '';

  // Payment details come from the musician's profile bank fields (if stored).
  // Adjust field names below to match your `profiles` schema.
  const paymentHTML = (profile?.bank_account_name || profile?.bank_account_number) ? `
    <div class="payment-box">
      <p class="label">Payment details</p>
      <div class="payment-grid">
        ${profile.bank_name           ? `<span class="pl">Bank</span><span>${profile.bank_name}</span>` : ''}
        ${profile.bank_account_name   ? `<span class="pl">Account name</span><span>${profile.bank_account_name}</span>` : ''}
        ${profile.bank_sort_code      ? `<span class="pl">Sort code</span><span>${profile.bank_sort_code}</span>` : ''}
        ${profile.bank_account_number ? `<span class="pl">Account number</span><span>${profile.bank_account_number}</span>` : ''}
        <span class="pl">Reference</span><span>${invNumber}</span>
      </div>
    </div>` : '';

  const notesHTML = claim.notes ? `
    <div class="footer-notes">
      <p>${claim.notes}</p>
    </div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>${invNumber}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet"/>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: white; font-family: 'Inter', sans-serif; color: #1a1a1a; font-size: 10pt; }
  .page { width: 210mm; min-height: 297mm; padding: 18mm 16mm 28mm; margin: 0 auto; position: relative; overflow: hidden; }

  .stamp { position: absolute; top: 38mm; right: 14mm; font-family: 'Space Grotesk', sans-serif; font-size: 34pt; font-weight: 700; letter-spacing: 0.1em; transform: rotate(-22deg); opacity: 0.1; border: 6px solid; padding: 4px 12px; border-radius: 4px; pointer-events: none; }
  .stamp--paid { color: #1f3d3a; border-color: #1f3d3a; }

  .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; margin-bottom: 10mm; }
  .musician-name { font-family: 'Space Grotesk', sans-serif; font-size: 22pt; font-weight: 700; color: #c8862e; margin: 0 0 5px; letter-spacing: -0.02em; }
  .from-detail { margin: 1px 0; font-size: 9pt; color: #555; line-height: 1.5; }
  .meta { text-align: right; flex-shrink: 0; }
  .meta-block { display: flex; flex-direction: column; align-items: flex-end; margin-bottom: 6px; }
  .meta-label { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.08em; color: #999; font-weight: 600; }
  .meta-value { font-family: 'IBM Plex Mono', monospace; font-size: 10pt; font-weight: 500; }

  .divider { height: 3px; background: linear-gradient(90deg, #c8862e 0%, #e8a84e 60%, transparent 100%); border-radius: 2px; margin-bottom: 8mm; }

  .parties { display: flex; gap: 12mm; margin-bottom: 8mm; }
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

  .totals { display: flex; flex-direction: column; align-items: flex-end; border-top: 2px solid #1e1b16; padding-top: 8px; margin-bottom: 8mm; }
  .totals-row { display: flex; gap: 32px; justify-content: flex-end; padding: 3px 10px; font-size: 9.5pt; color: #555; width: 100%; }
  .totals-row .amt { font-family: 'IBM Plex Mono', monospace; font-size: 9pt; min-width: 70px; text-align: right; }
  .totals-grand { background: #c8862e; border-radius: 4px; color: #fff; font-family: 'Space Grotesk', sans-serif; font-size: 12pt; font-weight: 700; padding: 8px 10px; margin-top: 6px; }
  .totals-grand .amt { font-family: 'Space Grotesk', sans-serif; font-size: 12pt; }

  .payment-box { background: #f5f2ec; border-radius: 6px; padding: 10px 14px; margin-bottom: 6mm; }
  .payment-grid { display: grid; grid-template-columns: 130px 1fr; gap: 4px 12px; font-size: 9.5pt; }
  .pl { color: #888; font-weight: 600; }

  .footer-notes { border-top: 1px solid #eee; padding-top: 4mm; margin-bottom: 4mm; font-size: 8.5pt; color: #777; line-height: 1.6; }
  .footer-notes p { margin: 0 0 4px; }

  .page-footer { position: absolute; bottom: 10mm; left: 16mm; right: 16mm; display: flex; justify-content: space-between; font-size: 7.5pt; color: #bbb; border-top: 1px solid #eee; padding-top: 4mm; }

  @media print {
    html, body { margin: 0; }
    .page { margin: 0; width: 100%; padding: 10mm 12mm 20mm; }
  }
</style>
</head>
<body>
<div class="page">
  ${stampHTML}

  <div class="header">
    <div>
      <h1 class="musician-name">${musicianName}</h1>
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
      <div class="meta-block">
        <span class="meta-label">Status</span>
        <span class="meta-value">${STATUS_LABELS[claim.status] || claim.status}</span>
      </div>
      ${isPaid ? `<div class="meta-block"><span class="meta-label">Paid date</span><span class="meta-value">${formatDate(paidDate)}</span></div>` : ''}
    </div>
  </div>

  <div class="divider"></div>

  <div class="parties">
    <div class="bill-to">
      <p class="label">Payment from</p>
      <p class="client-name">${band?.name || '—'}</p>
      ${band?.contact_email ? `<p class="detail">${band.contact_email}</p>` : ''}
      ${band?.contact_phone ? `<p class="detail">${band.contact_phone}</p>` : ''}
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
      <tr class="alt">
        <td class="desc">${claim.description}</td>
        <td class="num">1</td>
        <td class="num">£${poundsFromPence(total)}</td>
        <td class="num">£${poundsFromPence(total)}</td>
      </tr>
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
</body>
</html>`;
}

// -------------------------------------------------------------------
// Main component
// -------------------------------------------------------------------
export default function MusicianClaim({ gigId, myProfileId }) {
  const [claim, setClaim]       = useState(null);
  const [myLineup, setMyLineup] = useState(null);
  const [gig, setGig]           = useState(null);
  const [band, setBand]         = useState(null);
  const [profile, setProfile]   = useState(null);
  const [loading, setLoading]   = useState(true);
  const [editing, setEditing]   = useState(false);
  const [description, setDescription] = useState('');
  const [amountPounds, setAmountPounds] = useState('');
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
    ] = await Promise.all([
      supabase
        .from('musician_claims')
        .select('*')
        .eq('gig_id', gigId)
        .eq('profile_id', myProfileId)
        .maybeSingle(),
      supabase
        .from('gig_lineup')
        .select('travel_cost_pence, instrument_id, instruments(name)')
        .eq('gig_id', gigId)
        .eq('profile_id', myProfileId)
        .maybeSingle(),
      supabase
        .from('gigs')
        // Adjust the select to match your gigs → bands relationship field name
        .select('gig_date, start_time, end_time, band_id, venues(name, address)')
        .eq('id', gigId)
        .maybeSingle(),
      supabase
        .from('profiles')
        // Adjust fields to whatever your profiles table exposes for musicians
        .select('full_name, name, email, bank_name, bank_account_name, bank_sort_code, bank_account_number')
        .eq('id', myProfileId)
        .maybeSingle(),
    ]);

    setClaim(claimData);
    setMyLineup(lineupData);
    setGig(gigData);
    setProfile(profileData);

    // Fetch band separately once we have the band_id from the gig
    if (gigData?.band_id) {
      const { data: bandData } = await supabase
        .from('bands')
        .select('name, contact_email, contact_phone, address')
        .eq('id', gigData.band_id)
        .maybeSingle();
      setBand(bandData);
    }

    setLoading(false);
  }, [gigId, myProfileId]);

  useEffect(() => {
    load();
  }, [load]);

  function handlePrintInvoice() {
    if (!claim) return;
    const html = buildMusicianInvoiceHTML({ claim, gig, band, profile });
    const printWindow = window.open('', '_blank', 'width=900,height=750');
    if (!printWindow) {
      alert('Pop-up blocked — please allow pop-ups for this site and try again.');
      return;
    }
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.onload = () => {
      printWindow.focus();
      printWindow.print();
    };
  }

  function startCreate() {
    const travelPounds = myLineup?.travel_cost_pence
      ? (myLineup.travel_cost_pence / 100).toFixed(2)
      : '';
    setDescription(
      'Performance fee' +
        (myLineup?.instruments?.name ? ' — ' + myLineup.instruments.name : '')
    );
    setAmountPounds('');
    setNotes(travelPounds ? 'Includes £' + travelPounds + ' travel' : '');
    setEditing(true);
    setError(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const amountPence = Math.round(Number(amountPounds) * 100);
    if (!amountPence || amountPence <= 0) {
      setError('Please enter a valid amount.');
      setSaving(false);
      return;
    }

    const payload = {
      gig_id: gigId,
      profile_id: myProfileId,
      amount_pence: amountPence,
      description,
      notes: notes || null,
    };

    const { error: saveError } = claim
      ? await supabase
          .from('musician_claims')
          .update({ amount_pence: amountPence, description, notes: notes || null })
          .eq('id', claim.id)
      : await supabase.from('musician_claims').insert(payload);

    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    setEditing(false);
    load();
  }

  if (loading) return null;

  const canDownloadInvoice = claim && (claim.status === 'approved' || claim.status === 'paid');

  return (
    <div className="day-sheet__section">
      <h3 className="day-sheet__section-title">My payment claim</h3>

      {!claim && !editing && (
        <>
          {myLineup?.travel_cost_pence && (
            <p className="field__hint">
              Your calculated travel cost is £{poundsFromPence(myLineup.travel_cost_pence)} — you
              can include this in your claim.
            </p>
          )}
          <button
            className="btn btn--primary btn--small"
            style={{ marginTop: 8 }}
            onClick={startCreate}
          >
            Submit a claim for this gig
          </button>
        </>
      )}

      {claim && !editing && (
        <>
          <div className="claim-card">
            <div className="claim-card__row">
              <span className="claim-card__label">Amount</span>
              <span className="claim-card__amount">£{poundsFromPence(claim.amount_pence)}</span>
            </div>
            <div className="claim-card__row">
              <span className="claim-card__label">Description</span>
              <span>{claim.description}</span>
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
            {claim.status === 'pending' && (
              <button
                className="link-button"
                onClick={() => {
                  setDescription(claim.description);
                  setAmountPounds((claim.amount_pence / 100).toFixed(2));
                  setNotes(claim.notes || '');
                  setEditing(true);
                  setError(null);
                }}
              >
                Edit claim
              </button>
            )}
            {canDownloadInvoice && (
              <button
                className="btn btn--ghost btn--small"
                onClick={handlePrintInvoice}
              >
                Download invoice
              </button>
            )}
          </div>
        </>
      )}

      {editing && (
        <form className="inline-subform" onSubmit={handleSubmit}>
          <label className="field">
            <span className="field__label">Description</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
            />
          </label>
          <label className="field">
            <span className="field__label">Total amount (£)</span>
            <input
              type="number"
              step="0.01"
              value={amountPounds}
              onChange={(e) => setAmountPounds(e.target.value)}
              placeholder="e.g. 150.00"
              required
            />
            {myLineup?.travel_cost_pence && (
              <span className="field__hint">
                Your travel is £{poundsFromPence(myLineup.travel_cost_pence)} — include this in
                your total if applicable.
              </span>
            )}
          </label>
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
import { useState } from 'react';
import { supabase } from '../supabaseClient';
import { prepareLogoUpload } from '../utils/resizeImage.js';
import { confirmAsync } from '../utils/confirmService.js';
import { notify } from '../utils/toastService.js';

const LOGO_BUCKET = 'band-logos';

export default function BandForm({ band, onSaved, onCancel }) {
  const isEdit = Boolean(band);
  const [name, setName] = useState(band?.name || '');
  const [invoiceName, setInvoiceName] = useState(band?.invoice_name || '');
  const [notes, setNotes] = useState(band?.notes || '');
  const [contactEmail, setContactEmail] = useState(band?.contact_email || '');
  const [contactPhone, setContactPhone] = useState(band?.contact_phone || '');
  const [address, setAddress] = useState(band?.address || '');
  const [bankName, setBankName] = useState(band?.bank_name || '');
  const [bankAccountName, setBankAccountName] = useState(band?.bank_account_name || '');
  const [bankSortCode, setBankSortCode] = useState(band?.bank_sort_code || '');
  const [bankAccountNumber, setBankAccountNumber] = useState(band?.bank_account_number || '');
  const [vatNumber, setVatNumber] = useState(band?.vat_number || '');
  const [vatRate, setVatRate] = useState(band?.vat_rate ?? '');
  const [invoiceNotes, setInvoiceNotes] = useState(band?.invoice_notes || '');
  const [docAccentColour, setDocAccentColour] = useState(band?.doc_accent_colour || '#c8862e');
  const [docSecondaryColour, setDocSecondaryColour] = useState(band?.doc_secondary_colour || '#1f3d3a');
  const [ownerProfitPct, setOwnerProfitPct] = useState(band?.fee_split_owner_profit_pct ?? '');
  const [singerBonusPct, setSingerBonusPct] = useState(band?.fee_split_singer_bonus_pct ?? '');
  const [captainBonusPct, setCaptainBonusPct] = useState(band?.fee_split_captain_bonus_pct ?? '');
  const [djPct, setDjPct] = useState(band?.fee_split_dj_pct ?? '');
  const [roadiePct, setRoadiePct] = useState(band?.fee_split_roadie_pct ?? '');
  const [logoUrl, setLogoUrl] = useState(band?.logo_url || '');
  const [websiteUrl, setWebsiteUrl] = useState(band?.website_url || '');
  const [socialLinks, setSocialLinks] = useState(band?.social_links || []);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleLogoChange(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    // Fast, friendly rejection before we hand the file to createImageBitmap
    // -- a huge or maliciously crafted "decompression bomb" image (tiny on
    // disk, enormous once decoded) can otherwise hang or crash the tab.
    // This isn't the real security boundary (a determined attacker can call
    // the Storage API directly, bypassing the browser entirely) -- that's
    // enforced server-side by the band-logos bucket's own file size/mime
    // type limits, set in the restrict_band_logo_uploads migration.
    if (!file.type.startsWith('image/')) {
      setError("That doesn't look like an image file — please choose a photo or graphic.");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError('That image is too large (max 20MB) — please choose a smaller file.');
      return;
    }
    setUploadingLogo(true);
    setError(null);
    try {
      const prepared = await prepareLogoUpload(file);
      let invert = false;
      if (prepared.invertible) {
        invert = await confirmAsync(
          "This logo looks white or very light — it may not be visible on invoices with a white background. Invert the colours so it shows up (e.g. white becomes black)?"
        );
      }
      const blob = await prepared.toBlob(invert);
      const path = band.id + '/logo.webp';
      const { error: uploadError } = await supabase.storage
        .from(LOGO_BUCKET)
        .upload(path, blob, { upsert: true, contentType: 'image/webp' });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path);
      // Cache-bust so replacing an existing logo shows immediately instead
      // of the browser/CDN serving the old cached image at the same URL.
      const publicUrl = urlData.publicUrl + '?v=' + Date.now();
      const { error: dbError } = await supabase.from('bands').update({ logo_url: publicUrl }).eq('id', band.id);
      if (dbError) throw dbError;
      setLogoUrl(publicUrl);
    } catch (err) {
      setError(err.message);
    }
    setUploadingLogo(false);
  }

  async function handleRemoveLogo() {
    const ok = await confirmAsync('Remove this band\'s logo?');
    if (!ok) return;
    setUploadingLogo(true);
    const { error: removeError } = await supabase.storage.from(LOGO_BUCKET).remove([band.id + '/logo.webp']);
    if (removeError) { notify("Couldn't remove logo: " + removeError.message); setUploadingLogo(false); return; }
    const { error: dbError } = await supabase.from('bands').update({ logo_url: null }).eq('id', band.id);
    if (dbError) { notify("Couldn't remove logo: " + dbError.message); setUploadingLogo(false); return; }
    setLogoUrl('');
    setUploadingLogo(false);
  }

  function addSocialLink() {
    setSocialLinks((prev) => [...prev, { label: '', url: '' }]);
  }
  function updateSocialLink(index, field, value) {
    setSocialLinks((prev) => prev.map((link, i) => (i === index ? { ...link, [field]: value } : link)));
  }
  function removeSocialLink(index) {
    setSocialLinks((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const payload = {
      name,
      invoice_name: invoiceName || null,
      notes: notes || null,
      contact_email: contactEmail || null,
      contact_phone: contactPhone || null,
      address: address || null,
      website_url: websiteUrl || null,
      social_links: socialLinks.filter((link) => link.label.trim() && link.url.trim()),
      bank_name: bankName || null,
      bank_account_name: bankAccountName || null,
      bank_sort_code: bankSortCode || null,
      bank_account_number: bankAccountNumber || null,
      vat_number: vatNumber || null,
      vat_rate: vatRate === '' ? null : Number(vatRate),
      invoice_notes: invoiceNotes || null,
      doc_accent_colour: docAccentColour,
      doc_secondary_colour: docSecondaryColour,
      fee_split_owner_profit_pct: ownerProfitPct === '' ? null : Number(ownerProfitPct),
      fee_split_singer_bonus_pct: singerBonusPct === '' ? null : Number(singerBonusPct),
      fee_split_captain_bonus_pct: captainBonusPct === '' ? null : Number(captainBonusPct),
      fee_split_dj_pct: djPct === '' ? null : Number(djPct),
      fee_split_roadie_pct: roadiePct === '' ? null : Number(roadiePct),
    };

    const { error } = isEdit
      ? await supabase.from('bands').update(payload).eq('id', band.id)
      : await supabase.from('bands').insert(payload);

    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    onSaved?.();
  }

  return (
    <form className="entity-form" onSubmit={handleSubmit}>
      <label className="field">
        <span className="field__label">Band / agency name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>

      <label className="field">
        <span className="field__label">Official invoice name (optional)</span>
        <input
          value={invoiceName}
          onChange={(e) => setInvoiceName(e.target.value)}
          placeholder="e.g. Chip Shop Boys Entertainment Ltd"
        />
        <span className="field__hint">Used on invoices and musician claims instead of the band name above, if set.</span>
      </label>

      <label className="field">
        <span className="field__label">Notes</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </label>

      <p className="field__label" style={{ marginTop: 16, marginBottom: 8, fontWeight: 700 }}>Contact details (shown on invoices)</p>

      <div className="field-row">
        <label className="field">
          <span className="field__label">Email</span>
          <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Phone</span>
          <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
        </label>
      </div>

      <label className="field">
        <span className="field__label">Address</span>
        <textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} placeholder="Your trading address as it should appear on invoices" />
      </label>

      <label className="field">
        <span className="field__label">Website</span>
        <input type="url" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} placeholder="https://yourband.com" />
      </label>

      <div className="field">
        <span className="field__label">Social links</span>
        {socialLinks.map((link, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
            <input
              value={link.label}
              onChange={(e) => updateSocialLink(i, 'label', e.target.value)}
              placeholder="Instagram"
              list="social-platform-suggestions"
              style={{ flex: '0 1 140px' }}
            />
            <input
              type="url"
              value={link.url}
              onChange={(e) => updateSocialLink(i, 'url', e.target.value)}
              placeholder="https://instagram.com/yourband"
              style={{ flex: '1 1 auto' }}
            />
            <button
              type="button"
              className="link-button link-button--danger"
              onClick={() => removeSocialLink(i)}
              aria-label="Remove social link"
              style={{ flexShrink: 0 }}
            >
              ×
            </button>
          </div>
        ))}
        <datalist id="social-platform-suggestions">
          <option value="Instagram" />
          <option value="Facebook" />
          <option value="TikTok" />
          <option value="YouTube" />
          <option value="Twitter/X" />
          <option value="Spotify" />
        </datalist>
        <button type="button" className="btn btn--ghost btn--small" onClick={addSocialLink}>+ Add social link</button>
        <span className="field__hint" style={{ display: 'block', marginTop: 4 }}>Shown on invoices, quotes and contracts alongside the website above.</span>
      </div>

      <div className="field-row">
        <label className="field">
          <span className="field__label">VAT number (optional)</span>
          <input
            value={vatNumber}
            onChange={(e) => {
              const next = e.target.value;
              setVatNumber(next);
              // Default to the UK standard rate the moment a VAT number is
              // first entered -- one less step for the common case, still
              // freely editable for a reduced/zero rate or a correction.
              if (next && !vatNumber && vatRate === '') setVatRate('20');
            }}
            placeholder="e.g. GB123456789"
          />
        </label>
        {vatNumber && (
          <label className="field" style={{ maxWidth: 140 }}>
            <span className="field__label">VAT rate (%)</span>
            <input
              type="number"
              step="0.1"
              min="0"
              max="100"
              value={vatRate}
              onChange={(e) => setVatRate(e.target.value)}
              placeholder="e.g. 20"
            />
          </label>
        )}
      </div>

      <p className="field__label" style={{ marginTop: 16, marginBottom: 8, fontWeight: 700 }}>Bank details (shown on invoices for payment)</p>

      <div className="field-row">
        <label className="field">
          <span className="field__label">Bank name</span>
          <input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="e.g. Barclays" />
        </label>
        <label className="field">
          <span className="field__label">Account name</span>
          <input value={bankAccountName} onChange={(e) => setBankAccountName(e.target.value)} />
        </label>
      </div>

      <div className="field-row">
        <label className="field">
          <span className="field__label">Sort code</span>
          <input value={bankSortCode} onChange={(e) => setBankSortCode(e.target.value)} placeholder="XX-XX-XX" />
        </label>
        <label className="field">
          <span className="field__label">Account number</span>
          <input value={bankAccountNumber} onChange={(e) => setBankAccountNumber(e.target.value)} placeholder="XXXXXXXX" />
        </label>
      </div>

      <label className="field">
        <span className="field__label">Default invoice footer / payment terms</span>
        <textarea
          value={invoiceNotes}
          onChange={(e) => setInvoiceNotes(e.target.value)}
          rows={3}
          placeholder="e.g. Payment is due within 14 days of the invoice date. Thank you for your booking."
        />
      </label>

      <p className="field__label" style={{ marginTop: 16, marginBottom: 8, fontWeight: 700 }}>Logo</p>
      {isEdit ? (
        <div className="field">
          {logoUrl && (
            <div style={{ marginBottom: 10, padding: 12, background: 'var(--paper-raised)', border: '1px solid var(--line)', borderRadius: 10, display: 'inline-block' }}>
              <img src={logoUrl} alt="Band logo" style={{ maxWidth: 220, maxHeight: 80, display: 'block' }} />
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <label className="btn btn--ghost btn--small" style={{ cursor: 'pointer' }}>
              {uploadingLogo ? 'Uploading…' : logoUrl ? 'Replace logo' : 'Upload logo'}
              <input type="file" accept="image/*" onChange={handleLogoChange} disabled={uploadingLogo} style={{ display: 'none' }} />
            </label>
            {logoUrl && (
              <button type="button" className="link-button link-button--danger" onClick={handleRemoveLogo} disabled={uploadingLogo}>
                Remove
              </button>
            )}
          </div>
          <span className="field__hint" style={{ display: 'block', marginTop: 4 }}>
            Shown on this band's invoices, quotes and contracts. Resized and compressed automatically — any reasonable image works.
          </span>
        </div>
      ) : (
        <p className="field__hint" style={{ marginBottom: 8 }}>Save the band first, then edit it to add a logo.</p>
      )}

      <p className="field__label" style={{ marginTop: 16, marginBottom: 8, fontWeight: 700 }}>Document theme</p>
      <p className="field__hint" style={{ marginBottom: 8 }}>
        Used on this band's invoices, quotes and contracts (heading, divider, "total due" bar, "paid" stamp). This is separate
        from your own personal app colour theme, set on your profile.
      </p>

      <div className="field-row">
        <label className="field">
          <span className="field__label">Accent colour</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="color"
              value={docAccentColour}
              onChange={(e) => setDocAccentColour(e.target.value)}
              style={{ width: 44, height: 36, padding: 2, border: '1px solid var(--line)', borderRadius: 6 }}
            />
            <input
              value={docAccentColour}
              onChange={(e) => setDocAccentColour(e.target.value)}
              style={{ width: 90, fontFamily: 'var(--font-mono)' }}
              placeholder="#c8862e"
            />
          </div>
        </label>
        <label className="field">
          <span className="field__label">Secondary colour</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="color"
              value={docSecondaryColour}
              onChange={(e) => setDocSecondaryColour(e.target.value)}
              style={{ width: 44, height: 36, padding: 2, border: '1px solid var(--line)', borderRadius: 6 }}
            />
            <input
              value={docSecondaryColour}
              onChange={(e) => setDocSecondaryColour(e.target.value)}
              style={{ width: 90, fontFamily: 'var(--font-mono)' }}
              placeholder="#1f3d3a"
            />
          </div>
        </label>
      </div>

      <p className="field__label" style={{ marginTop: 16, marginBottom: 8, fontWeight: 700 }}>Fee split defaults (optional)</p>
      <p className="field__hint" style={{ marginBottom: 8 }}>
        Each is a % of the total gig fee, taken off the top — leave any blank if the band doesn't use it. Musicians then split
        whatever's left evenly across however many are actually booked, so a 3-piece and a 7-piece both get a sensible share of
        the same fee instead of a fixed cut each that wouldn't scale.
      </p>

      <div className="field-row">
        <label className="field">
          <span className="field__label">Owner / band-leader profit (%)</span>
          <input type="number" min="0" max="100" step="0.1" value={ownerProfitPct} onChange={(e) => setOwnerProfitPct(e.target.value)} placeholder="e.g. 30" />
          <span className="field__hint">A band-level pot — e.g. an agent's cut. Not paid to any individual musician, even if they're also playing.</span>
        </label>
        <label className="field">
          <span className="field__label">Captain bonus (%)</span>
          <input type="number" min="0" max="100" step="0.1" value={captainBonusPct} onChange={(e) => setCaptainBonusPct(e.target.value)} placeholder="e.g. 2.5" />
          <span className="field__hint">Extra pay for whoever leads on the day — a real payout, separate from owner profit above.</span>
        </label>
      </div>

      <div className="field-row">
        <label className="field">
          <span className="field__label">Singer bonus (%)</span>
          <input type="number" min="0" max="100" step="0.1" value={singerBonusPct} onChange={(e) => setSingerBonusPct(e.target.value)} placeholder="e.g. 2.5" />
        </label>
        <label className="field">
          <span className="field__label">DJ (%)</span>
          <input type="number" min="0" max="100" step="0.1" value={djPct} onChange={(e) => setDjPct(e.target.value)} placeholder="e.g. 7.5" />
        </label>
        <label className="field">
          <span className="field__label">Roadie (%)</span>
          <input type="number" min="0" max="100" step="0.1" value={roadiePct} onChange={(e) => setRoadiePct(e.target.value)} placeholder="e.g. 7.5" />
        </label>
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="form-actions">
        <button type="button" className="btn btn--ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn--primary" disabled={submitting}>
          {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Save band'}
        </button>
      </div>
    </form>
  );
}
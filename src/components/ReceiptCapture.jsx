import { useEffect, useState } from 'react';
import { captureReceipt, receiptSignedUrl, deleteReceipt, poundsFromPence } from '../utils/receipts.js';
import { EXPENSE_CATEGORIES } from '../utils/expenseCategories.js';
import { SA103_EXPENSE_BOX } from '../utils/sa103Boxes.js';
import DateInput from './DateInput.jsx';
import NumberInput from './NumberInput.jsx';
import { todayStr, formatShortDate } from '../utils/formatDate.js';

function describeReceipt(r) {
  return [
    r.merchant_name,
    r.transaction_date && formatShortDate(r.transaction_date),
    r.total_pence != null && '£' + poundsFromPence(r.total_pence),
  ].filter(Boolean).join(' · ') || 'an earlier scan';
}

// Marks a field the extractor wasn't sure about, so the confirm step points
// at the two values worth re-reading instead of asking for all of them.
function LowConfidence({ confidence }) {
  if (confidence !== 'low') return null;
  return (
    <span style={{ color: 'var(--rust)', fontWeight: 600 }} title="The extractor wasn't confident about this — worth checking">
      {' '}⚠ check
    </span>
  );
}

// Compact variant for a claim's line-item editor, where the surrounding row
// already has category/description/amount fields -- so rather than showing
// its own review form, this just fills those fields in and hands back the
// receipt id for the line to carry. The musician still sees and can correct
// every value before the claim is submitted, so the "model pre-fills, human
// commits" rule holds here too.
export function ReceiptLineAttach({ profileId, attached, onExtracted, onError }) {
  const [busy, setBusy] = useState(false);

  async function run(file, options) {
    const res = await captureReceipt(file, profileId, options);

    // In the compact editor there's no room for a two-step "are you sure"
    // flow, so a soft block becomes a confirm() and the answer is fed
    // straight back into a retry with the matching override.
    if (res.blocked === 'quality') {
      const msg = res.quality.warnings.map((w) => w.message).join(' ');
      if (!window.confirm(msg + '\n\nAttach it anyway?')) return null;
      return run(file, { ...options, allowLowQuality: true });
    }
    if (res.blocked === 'duplicate') {
      if (!window.confirm(`You've already scanned this exact photo (${describeReceipt(res.duplicate)}).\n\nAttach it again?`)) return null;
      return run(file, { ...options, allowDuplicate: true });
    }
    return res;
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const res = await run(file, {});
      if (!res) return;
      const { receipt, extractionError, similarTo } = res;
      onExtracted({
        receipt_id: receipt.id,
        description: receipt.raw_extraction?.suggested_description || receipt.merchant_name || '',
        amountPounds: receipt.total_pence != null ? poundsFromPence(receipt.total_pence) : '',
      });
      if (similarTo) {
        onError?.(`Heads up — you already have a receipt for ${describeReceipt(similarTo)}. Check you're not claiming it twice.`);
      } else if (extractionError) {
        onError?.(
          extractionError.startsWith('PRO_REQUIRED:')
            ? extractionError.replace('PRO_REQUIRED: ', '')
            : extractionError + ' The photo is attached — check the amount.'
        );
      }
    } catch (err) {
      onError?.(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <label
      className="link-button"
      style={{ cursor: 'pointer', marginBottom: 10, whiteSpace: 'nowrap' }}
      title={attached ? 'Receipt attached — take another to replace it' : 'Attach a photo of the receipt'}
    >
      {busy ? '…' : attached ? '📎 Receipt' : '📷 Receipt'}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFile}
        disabled={busy}
        style={{ display: 'none' }}
      />
    </label>
  );
}

// Photograph a receipt, have the fields read off it, then confirm.
//
// The confirmation step is deliberate and not skippable: this feeds a tax
// return, so the model only ever pre-fills and a human always commits. When
// the read is clean that's a single tap; when it isn't, every field is
// still editable and the photo is kept either way -- HMRC accepts a legible
// photo as the record on its own, whether or not anything could be parsed
// out of it.
export default function ReceiptCapture({
  profileId,
  onFiled,
  onCancel,
  categories = EXPENSE_CATEGORIES,
  showCategory = true,
}) {
  // idle | working | blocked | review
  const [phase, setPhase] = useState('idle');
  const [busyLabel, setBusyLabel] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [warning, setWarning] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [cropped, setCropped] = useState(false);
  const [similarTo, setSimilarTo] = useState(null);
  // What tripped the pre-flight check, plus the file to retry with.
  const [block, setBlock] = useState(null);

  // Review-form fields
  const [date, setDate] = useState(todayStr());
  const [category, setCategory] = useState(categories[0]);
  const [description, setDescription] = useState('');
  const [amountPounds, setAmountPounds] = useState('');

  useEffect(() => {
    if (!receipt?.storage_path) return;
    let active = true;
    receiptSignedUrl(receipt.storage_path).then((url) => {
      if (active) setPreviewUrl(url);
    });
    return () => { active = false; };
  }, [receipt?.storage_path]);

  async function process(file, options) {
    setError(null);
    setWarning(null);
    setPhase('working');
    setBusyLabel(options.allowLowQuality || options.allowDuplicate ? 'Reading receipt…' : 'Checking photo…');

    try {
      const res = await captureReceipt(file, profileId, options);

      if (res.blocked) {
        setBlock({ kind: res.blocked, file, options, quality: res.quality, duplicate: res.duplicate });
        setPhase('blocked');
        return;
      }

      const row = res.receipt;
      setReceipt(row);
      setCropped(res.cropped);
      setSimilarTo(res.similarTo || null);
      setBlock(null);

      if (res.extractionError) {
        setWarning(
          res.extractionError.startsWith('PRO_REQUIRED:')
            ? res.extractionError.replace('PRO_REQUIRED: ', '')
            : res.extractionError + ' The photo is saved — fill the details in below.'
        );
      }

      const suggested = row.raw_extraction?.suggested_description;
      setDate(row.transaction_date || todayStr());
      setCategory(categories.includes(row.suggested_category) ? row.suggested_category : categories[0]);
      setDescription(suggested || row.merchant_name || '');
      setAmountPounds(row.total_pence != null ? poundsFromPence(row.total_pence) : '');
      setPhase('review');
    } catch (err) {
      setError(err.message);
      setPhase('idle');
    }
  }

  function handleFile(e) {
    const file = e.target.files?.[0];
    // Reset so re-picking the very same file still fires a change event.
    e.target.value = '';
    if (!file) return;
    process(file, {});
  }

  function continueAnyway() {
    const override = block.kind === 'quality' ? { allowLowQuality: true } : { allowDuplicate: true };
    process(block.file, { ...block.options, ...override });
  }

  async function handleConfirm(e) {
    e.preventDefault();
    setError(null);

    if (!description.trim()) { setError('Add a description.'); return; }
    const amountPence = Math.round(Number(amountPounds) * 100);
    if (!amountPence || amountPence <= 0) { setError('Enter a valid amount.'); return; }

    setSaving(true);
    try {
      await onFiled({
        receipt_id: receipt.id,
        date,
        category,
        description: description.trim(),
        amount_pence: amountPence,
      });
      reset();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDiscard() {
    // Only reachable before the receipt is attached to anything, so removing
    // it outright is safe -- nothing references it yet.
    if (receipt) {
      try { await deleteReceipt(receipt); } catch { /* leave it in the unfiled pile */ }
    }
    reset();
    onCancel?.();
  }

  function reset() {
    setPhase('idle');
    setReceipt(null);
    setPreviewUrl(null);
    setWarning(null);
    setError(null);
    setBlock(null);
    setSimilarTo(null);
    setCropped(false);
  }

  if (phase === 'idle') {
    return (
      <>
        <label className="btn btn--ghost btn--small" style={{ cursor: 'pointer', marginBottom: 12 }}>
          📷 Scan receipt
          <input
            type="file"
            accept="image/*"
            // Opens the rear camera straight away on a phone rather than a
            // file browser -- this is nearly always used standing in a shop
            // or at a gig, not picking an existing file.
            capture="environment"
            onChange={handleFile}
            style={{ display: 'none' }}
          />
        </label>
        {error && <p className="form-error">{error}</p>}
      </>
    );
  }

  if (phase === 'working') {
    return <p className="field__hint" style={{ marginBottom: 12 }}>{busyLabel}</p>;
  }

  // Nothing has been uploaded or charged for at this point -- this is the
  // pre-flight check, and retaking is free.
  if (phase === 'blocked') {
    return (
      <div className="inline-subform" style={{ marginBottom: 12 }}>
        {block.kind === 'quality' ? (
          <>
            {block.quality.warnings.map((w) => (
              <p key={w.code} className="form-error" style={{ marginBottom: 6 }}>{w.message}</p>
            ))}
            <p className="field__hint">Retaking is free — reading a poor photo often isn't worth it.</p>
          </>
        ) : (
          <>
            <p className="form-error" style={{ marginBottom: 6 }}>
              You've already scanned this exact photo — {describeReceipt(block.duplicate)}.
            </p>
            <p className="field__hint">Claiming one purchase twice is the kind of thing HMRC does notice.</p>
          </>
        )}
        <div className="form-actions">
          <button type="button" className="btn btn--ghost btn--small" onClick={reset}>
            {block.kind === 'quality' ? 'Retake' : 'Cancel'}
          </button>
          <button type="button" className="btn btn--primary btn--small" onClick={continueAnyway}>
            Use it anyway
          </button>
        </div>
      </div>
    );
  }

  const conf = receipt.field_confidence || {};
  const vatLine = [
    receipt.subtotal_pence != null && `Net £${poundsFromPence(receipt.subtotal_pence)}`,
    receipt.vat_pence != null && `VAT £${poundsFromPence(receipt.vat_pence)}`,
    receipt.vat_number && `VAT no. ${receipt.vat_number}`,
  ].filter(Boolean).join(' · ');

  return (
    <form className="inline-subform" onSubmit={handleConfirm} style={{ marginBottom: 12 }}>
      {similarTo && (
        <p className="form-error" style={{ marginBottom: 6 }}>
          You already have a receipt for {describeReceipt(similarTo)} — check you're not claiming it twice.
        </p>
      )}
      {warning && <p className="field__hint" style={{ color: 'var(--rust)' }}>{warning}</p>}
      {/* Arithmetic that doesn't add up is the cheapest OCR-error detector
          there is, so surface it rather than quietly trusting the read. */}
      {receipt.quality_warnings?.map((w) => (
        <p key={w.code} className="field__hint" style={{ color: 'var(--rust)' }}>{w.message}</p>
      ))}

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {previewUrl && (
          <a href={previewUrl} target="_blank" rel="noopener noreferrer" style={{ flex: '0 0 auto' }}>
            <img
              src={previewUrl}
              alt="Receipt"
              style={{ width: 90, borderRadius: 8, border: '1px solid var(--line)', display: 'block' }}
            />
          </a>
        )}
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          {receipt.merchant_name && (
            <p className="simple-list__title" style={{ margin: 0 }}>
              {receipt.merchant_name}<LowConfidence confidence={conf.merchant_name} />
            </p>
          )}
          <p className="field__hint" style={{ margin: '2px 0 0' }}>
            {[receipt.transaction_date, receipt.transaction_time?.slice(0, 5), receipt.payment_method]
              .filter(Boolean).join(' · ') || 'No date read — check below'}
          </p>
          {vatLine && <p className="field__hint" style={{ margin: '2px 0 0' }}>{vatLine}</p>}
          {cropped && (
            <p className="field__hint" style={{ margin: '2px 0 0' }}>Cropped and straightened automatically.</p>
          )}
        </div>
      </div>

      {receipt.line_items?.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary className="field__hint" style={{ cursor: 'pointer', userSelect: 'none' }}>
            {receipt.line_items.length} item{receipt.line_items.length === 1 ? '' : 's'} read from the receipt
          </summary>
          <ul className="field__hint" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {receipt.line_items.map((li, i) => (
              <li key={i}>
                {li.description}
                {li.quantity ? ` ×${li.quantity}` : ''}
                {li.total != null ? ` — £${Number(li.total).toFixed(2)}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        <label className="field" style={{ flex: '1 1 140px' }}>
          <span className="field__label">Date<LowConfidence confidence={conf.transaction_date} /></span>
          <DateInput value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        {showCategory && (
          <label className="field" style={{ flex: '1 1 180px' }}>
            <span className="field__label">Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {categories.map((c) => (
                <option key={c} value={c}>{c}{SA103_EXPENSE_BOX[c] ? ` (${SA103_EXPENSE_BOX[c]})` : ''}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      <label className="field">
        <span className="field__label">Description</span>
        <input value={description} onChange={(e) => setDescription(e.target.value)} required />
      </label>

      <label className="field">
        <span className="field__label">Amount (£)<LowConfidence confidence={conf.total} /></span>
        <NumberInput
          decimals={2}
          min={0}
          prefix="£"
          value={amountPounds}
          onChange={(e) => setAmountPounds(e.target.value)}
          placeholder="0.00"
          required
        />
      </label>

      {error && <p className="form-error">{error}</p>}

      <div className="form-actions">
        <button type="button" className="btn btn--ghost btn--small" onClick={handleDiscard} disabled={saving}>
          Discard
        </button>
        <button type="submit" className="btn btn--primary btn--small" disabled={saving}>
          {saving ? 'Saving…' : 'Save expense'}
        </button>
      </div>
    </form>
  );
}

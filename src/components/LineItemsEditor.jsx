import { useState } from 'react';

function poundsFromPence(pence) {
  return (pence / 100).toFixed(2);
}

// Keep only digits and a single decimal point, so a stray character typed
// on a mobile keyboard doesn't get silently dropped mid-edit.
function sanitizeMoneyInput(raw) {
  let v = raw.replace(/[^0-9.]/g, '');
  const dot = v.indexOf('.');
  if (dot !== -1) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, '');
  return v;
}

// Shared by InvoiceEditor and QuoteEditor. Previously a <table> with five
// squeezed columns (description/qty/unit/total/remove) -- on a narrow
// screen the description input shrank to a sliver and, per a real iPhone
// report, cells rendered overlapping rather than the clean single-column
// stack this same layout showed in desktop-based mobile emulation (Chrome
// devtools/this app's own preview tooling force a viewport width
// regardless of the page, masking table/native-control quirks real
// mobile Safari doesn't smooth over the same way). A card-per-item layout
// sidesteps table column negotiation entirely -- description gets its own
// full-width row, and qty/unit/total sit in a row of three short fields
// that comfortably fits even a small phone screen.
export default function LineItemsEditor({ items, onChange }) {
  // While a unit-price field is focused, its displayed text is whatever
  // the user is typing (not re-derived from unit_amount_pence on every
  // keystroke) so backspacing to clear it, or typing "50" for a whole
  // pound amount, doesn't fight a forced ".00". Formatting back to two
  // decimal places happens once, on blur.
  const [unitDrafts, setUnitDrafts] = useState({});

  function updateItem(index, field, value) {
    onChange(items.map((item, i) => (i === index ? { ...item, [field]: value } : item)));
  }
  function addItem() {
    onChange([...items, { id: null, description: '', quantity: 1, unit_amount_pence: 0, sort_order: items.length }]);
  }
  function removeItem(index) {
    onChange(items.filter((_, i) => i !== index));
    setUnitDrafts((d) => {
      const next = { ...d };
      delete next[index];
      return next;
    });
  }

  function handleUnitFocus(index, pence) {
    setUnitDrafts((d) => ({ ...d, [index]: pence ? poundsFromPence(pence) : '' }));
  }
  function handleUnitChange(index, raw) {
    const clean = sanitizeMoneyInput(raw);
    setUnitDrafts((d) => ({ ...d, [index]: clean }));
    updateItem(index, 'unit_amount_pence', clean === '' || clean === '.' ? 0 : Math.round(Number(clean) * 100));
  }
  function handleUnitBlur(index) {
    setUnitDrafts((d) => {
      const next = { ...d };
      delete next[index];
      return next;
    });
  }

  const total = items.reduce((sum, i) => sum + (Number(i.unit_amount_pence) || 0) * (Number(i.quantity) || 1), 0);

  return (
    <div className="line-items">
      {items.map((item, i) => (
        <div className="line-item" key={i}>
          <div className="line-item__desc-row">
            <input
              value={item.description}
              onChange={(e) => updateItem(i, 'description', e.target.value)}
              placeholder="Description"
            />
            <button
              type="button"
              className="link-button link-button--danger line-item__remove"
              onClick={() => removeItem(i)}
              aria-label="Remove line item"
              title="Remove"
            >
              ×
            </button>
          </div>
          <div className="line-item__numbers-row">
            <label className="line-item__field">
              <span>Qty</span>
              <input
                type="number"
                min="1"
                step="0.5"
                value={item.quantity}
                onChange={(e) => updateItem(i, 'quantity', e.target.value)}
              />
            </label>
            <label className="line-item__field">
              <span>Unit (£)</span>
              <input
                type="text"
                inputMode="decimal"
                value={i in unitDrafts ? unitDrafts[i] : poundsFromPence(item.unit_amount_pence)}
                onFocus={() => handleUnitFocus(i, item.unit_amount_pence)}
                onChange={(e) => handleUnitChange(i, e.target.value)}
                onBlur={() => handleUnitBlur(i)}
              />
            </label>
            <div className="line-item__total">
              <span>Total</span>
              <strong>£{poundsFromPence((Number(item.unit_amount_pence) || 0) * (Number(item.quantity) || 1))}</strong>
            </div>
          </div>
        </div>
      ))}

      <button type="button" className="link-button" style={{ marginTop: 4 }} onClick={addItem}>
        + Add line item
      </button>

      <div className="line-items__grand-total">
        <span>Total</span>
        <strong>£{poundsFromPence(total)}</strong>
      </div>
    </div>
  );
}

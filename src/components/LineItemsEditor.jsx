import NumberInput from './NumberInput.jsx';

function poundsFromPence(pence) {
  return (pence / 100).toFixed(2);
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
  function updateItem(index, field, value) {
    onChange(items.map((item, i) => (i === index ? { ...item, [field]: value } : item)));
  }
  function addItem() {
    onChange([...items, { id: null, description: '', quantity: 1, unit_amount_pence: 0, sort_order: items.length }]);
  }
  function removeItem(index) {
    onChange(items.filter((_, i) => i !== index));
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
              <NumberInput
                decimals={1}
                min={1}
                value={item.quantity}
                onChange={(e) => updateItem(i, 'quantity', e.target.value)}
              />
            </label>
            <label className="line-item__field">
              <span>Unit (£)</span>
              <NumberInput
                decimals={2}
                min={0}
                prefix="£"
                value={poundsFromPence(item.unit_amount_pence)}
                onChange={(e) => updateItem(i, 'unit_amount_pence', Math.round(Number(e.target.value || 0) * 100))}
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

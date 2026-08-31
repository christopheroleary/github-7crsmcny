import { EQUIPMENT_ITEMS } from '../utils/equipment.js';

// Shared editor for the "what gear do they bring" checklist -- used both
// for a musician's own dep profile (DepProfile) and for a placeholder dep
// managed on their behalf (DepDetailsEditor). `values` is the equipment_*
// boolean subset of the row being edited; `notes` is a free-text field
// since the booleans alone can't capture capacity/quality ("covers up to
// 300 cap", "16ch digital desk") which matters as much as the checklist.
export default function EquipmentFields({ values, onToggle, notes, onNotesChange }) {
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 18px' }}>
        {EQUIPMENT_ITEMS.map((item) => (
          <label key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={Boolean(values[item.key])}
              onChange={(e) => onToggle(item.key, e.target.checked)}
              style={{ width: 'auto' }}
            />
            <span>{item.icon} {item.label}</span>
          </label>
        ))}
      </div>
      <textarea
        value={notes || ''}
        onChange={(e) => onNotesChange(e.target.value)}
        placeholder="Rig details — capacity it covers, desk channels, anything worth knowing…"
        rows={2}
        style={{ marginTop: 8, width: '100%' }}
      />
    </div>
  );
}

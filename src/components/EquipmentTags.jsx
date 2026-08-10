import { EQUIPMENT_ITEMS } from '../utils/equipment.js';

// Compact read-only badges so equipment capability is visible on a
// musician/dep's row without having to expand or edit it.
export default function EquipmentTags({ values }) {
  const present = EQUIPMENT_ITEMS.filter((item) => values?.[item.key]);
  if (present.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
      {present.map((item) => (
        <span className="tag" key={item.key} style={{ paddingRight: 10 }}>
          {item.icon} {item.label}
        </span>
      ))}
    </div>
  );
}

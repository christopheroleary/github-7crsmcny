// Shared list of equipment a musician or dep might bring to a gig, used by
// both the editable checklist (EquipmentFields) and the read-only badges
// (EquipmentTags). Keep the `key` values in sync with the boolean columns
// on profiles/placeholder_musicians (has_pa, has_subs, ...).
export const EQUIPMENT_ITEMS = [
  { key: 'has_pa', label: 'PA system', icon: '🔊' },
  { key: 'has_subs', label: 'Subs', icon: '🔊' },
  { key: 'has_iem', label: 'IEMs', icon: '🎧' },
  { key: 'has_mics', label: 'Mics', icon: '🎤' },
  { key: 'has_cables', label: 'Cables', icon: '🔌' },
  { key: 'has_lighting', label: 'Lighting', icon: '💡' },
];

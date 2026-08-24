import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useCurrentProfile } from '../context/ProfileContext.jsx';
import InstrumentPicker from './InstrumentPicker.jsx';
import EquipmentFields from './EquipmentFields.jsx';
import { EQUIPMENT_ITEMS } from '../utils/equipment.js';
import { confirmAsync } from '../utils/confirmService.js';
import AddressAutocomplete from './AddressAutocomplete.jsx';

export default function MusicianEditForm({ profile, onSaved, onCancel }) {
  const { isAdmin } = useCurrentProfile();
  const [fullName, setFullName] = useState(profile.full_name || '');
  const [phone, setPhone] = useState(profile.phone || '');
  const [homeAddress, setHomeAddress] = useState(profile.home_address || '');
  const [homeLat, setHomeLat] = useState(profile.home_latitude ?? null);
  const [homeLon, setHomeLon] = useState(profile.home_longitude ?? null);
  const [role, setRole] = useState(profile.role || 'band_member');
  const [isActive, setIsActive] = useState(profile.is_active);
  const [equipment, setEquipment] = useState(
    Object.fromEntries(EQUIPMENT_ITEMS.map((item) => [item.key, Boolean(profile[item.key])]))
  );
  const [equipmentNotes, setEquipmentNotes] = useState(profile.equipment_notes || '');
  const [allInstruments, setAllInstruments] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [originalIds, setOriginalIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function load() {
      const [{ data: instruments }, { data: links }] = await Promise.all([
        supabase.from('instruments').select('id, name').order('sort_order'),
        supabase.from('profile_instruments').select('instrument_id').eq('profile_id', profile.id),
      ]);
      setAllInstruments(instruments || []);
      const ids = (links || []).map((l) => l.instrument_id);
      setSelectedIds(ids);
      setOriginalIds(ids);
      setLoading(false);
    }
    load();
  }, [profile.id]);

  async function handleSubmit(e) {
    e.preventDefault();

    // Guards against silently wiping every instrument this musician had --
    // e.g. the picker not finishing its fetch before a fast Save click, or
    // an accidental click on every tag's × in a row. Only fires when they
    // previously had instruments and now have none; removing some while
    // keeping others needs no extra confirmation.
    if (originalIds.length > 0 && selectedIds.length === 0) {
      const ok = await confirmAsync(
        'This removes every instrument ' + (fullName || 'this musician') + ' had set (' + originalIds.length + '). Continue?'
      );
      if (!ok) return;
    }

    setSaving(true);
    setError(null);

    const updates = {
      full_name: fullName,
      phone: phone || null,
      home_address: homeAddress || null,
      home_latitude: homeLat,
      home_longitude: homeLon,
      is_active: isActive,
      ...equipment,
      equipment_notes: equipmentNotes || null,
    };
    if (isAdmin) updates.role = role;

    const { error: profileError } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', profile.id);

    let writeError = profileError;
    const toAdd = selectedIds.filter((id) => !originalIds.includes(id));
    const toRemove = originalIds.filter((id) => !selectedIds.includes(id));

    if (!writeError && toAdd.length > 0) {
      const { error } = await supabase
        .from('profile_instruments')
        .insert(toAdd.map((instrument_id) => ({ profile_id: profile.id, instrument_id })));
      writeError = error;
    }
    if (!writeError && toRemove.length > 0) {
      const { error } = await supabase
        .from('profile_instruments')
        .delete()
        .eq('profile_id', profile.id)
        .in('instrument_id', toRemove);
      writeError = error;
    }

    setSaving(false);
    if (writeError) setError(writeError.message);
    else onSaved?.();
  }

  if (loading) return <p className="state-message">Loading…</p>;

  return (
    <form className="entity-form" onSubmit={handleSubmit}>
      <label className="field">
        <span className="field__label">Name</span>
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
      </label>

      <label className="field">
        <span className="field__label">Phone</span>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} />
      </label>

      <label className="field">
        <span className="field__label">Home address</span>
        <AddressAutocomplete
          value={homeAddress}
          onChange={(text) => {
            setHomeAddress(text);
            setHomeLat(null);
            setHomeLon(null);
          }}
          onCoordinatesChange={(lat, lon) => {
            setHomeLat(lat);
            setHomeLon(lon);
          }}
          placeholder="Start typing their home address…"
        />
        {homeLat != null && <span className="field__hint">Location set ✓</span>}
        {homeLat == null && homeAddress && (
          <span className="field__hint" style={{ color: 'var(--rust)' }}>
            Pick a suggestion from the dropdown to set the map pin — needed for distance calculation.
          </span>
        )}
      </label>

      <label className="field">
        <span className="field__label">Instruments</span>
        <InstrumentPicker
          allInstruments={allInstruments}
          selectedIds={selectedIds}
          onAdd={(id) => setSelectedIds((prev) => (prev.includes(id) ? prev : [...prev, id]))}
          onRemove={(id) => setSelectedIds((prev) => prev.filter((x) => x !== id))}
        />
      </label>

      <div className="field">
        <span className="field__label">Equipment they can bring</span>
        <EquipmentFields
          values={equipment}
          onToggle={(key, checked) => setEquipment((prev) => ({ ...prev, [key]: checked }))}
          notes={equipmentNotes}
          onNotesChange={setEquipmentNotes}
        />
      </div>

      {isAdmin && (
        <label className="field">
          <span className="field__label">Role</span>
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="band_member">Band member</option>
            <option value="band_leader">Band leader / owner</option>
            <option value="admin">Admin</option>
          </select>
        </label>
      )}

      <label className="field field--checkbox">
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
        <span>Active band member</span>
      </label>

      {error && <p className="form-error">{error}</p>}

      <div className="form-actions">
        <button type="button" className="btn btn--ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn--primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}
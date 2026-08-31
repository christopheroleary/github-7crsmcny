import { useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useCurrentProfile } from '../context/ProfileContext.jsx';
import EquipmentFields from './EquipmentFields.jsx';
import { EQUIPMENT_ITEMS } from '../utils/equipment.js';
import MyAvailability from './MyAvailability.jsx';
import MyRepertoire from './MyRepertoire.jsx';
import InfoTooltip from './InfoTooltip.jsx';
import { notify } from '../utils/toastService.js';

const AUTOSAVE_DELAY = 700;
// Same green/red pair as the day-chips in MyAvailability.jsx -- kept
// identical on purpose so "opted in" reads the same way in both places.
const AVAILABLE_COLOUR = '#2f7d4f';
const UNAVAILABLE_COLOUR = '#b6452c'; // matches --rust, stable across all UI themes

// Everything gated behind "Available for dep work" on the old single
// MyProfile.jsx page, now its own tab -- own profile row's own id comes
// straight from the already-loaded ProfileContext (no separate
// supabase.auth.getUser() needed here, unlike Settings.jsx which also
// needs the login email).
export default function DepProfile() {
  const { profile } = useCurrentProfile();
  const userId = profile?.id || null;
  const [loading, setLoading] = useState(true);
  const [availableForDepWork, setAvailableForDepWork] = useState(false);
  const [equipment, setEquipment] = useState({});
  const [equipmentNotes, setEquipmentNotes] = useState('');

  useEffect(() => {
    if (!userId) return;
    async function load() {
      const { data, error } = await supabase
        .from('profiles')
        .select('available_for_dep_work, has_pa, has_subs, has_iem, has_mics, has_cables, has_lighting, equipment_notes')
        .eq('id', userId)
        .single();
      if (error) notify("Couldn't load your dep profile: " + error.message);
      else {
        setAvailableForDepWork(Boolean(data.available_for_dep_work));
        setEquipment(Object.fromEntries(EQUIPMENT_ITEMS.map((item) => [item.key, Boolean(data[item.key])])));
        setEquipmentNotes(data.equipment_notes || '');
      }
      setLoading(false);
    }
    load();
  }, [userId]);

  // Same guarded-autosave pattern as Settings.jsx -- see the comment there
  // for why readyRef exists.
  const readyRef = useRef(false);

  async function persist(patch) {
    const { error } = await supabase.from('profiles').update(patch).eq('id', userId);
    if (error) notify("Couldn't save: " + error.message);
  }

  useEffect(() => {
    if (!readyRef.current || !userId) return;
    const t = setTimeout(() => persist({ ...equipment, equipment_notes: equipmentNotes || null }), AUTOSAVE_DELAY);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equipment, equipmentNotes]);

  useEffect(() => {
    if (!loading) readyRef.current = true;
  }, [loading]);

  async function handleDepToggle(checked) {
    setAvailableForDepWork(checked);
    await persist({ available_for_dep_work: checked });
  }

  if (loading) return <p className="state-message">Loading…</p>;

  const chipColour = availableForDepWork ? AVAILABLE_COLOUR : UNAVAILABLE_COLOUR;

  return (
    <>
      <div className="section-header">
        <h2 className="section-header__title">Dep profile</h2>
      </div>

      <div className="entity-form">
        <p className="field__hint" style={{ marginTop: 0, marginBottom: 16 }}>
          Opt in to being offered dep/session work — on bands you're not even
          a member of, not just your own.
        </p>

        <div className="field" style={{ display: 'flex', alignItems: 'center', gap: 8, flexDirection: 'row' }}>
          <button
            type="button"
            onClick={() => handleDepToggle(!availableForDepWork)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 12px',
              borderRadius: 20,
              border: '1px solid ' + chipColour + '55',
              background: chipColour + '1f',
              color: chipColour,
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            <span aria-hidden="true">{availableForDepWork ? '✓' : '✕'}</span>
            <span>Available for dep work</span>
          </button>
          <InfoTooltip text="Makes your profile visible to band leaders looking for deps/session musicians, even for bands you're not on. Off by default." />
        </div>

        {availableForDepWork && (
        <div style={{ background: 'var(--paper-raised)', border: '1px solid var(--line)', borderRadius: 10, padding: '2px 14px 14px', margin: '4px 0 18px' }}>
          <p className="field__hint" style={{ marginTop: 12, marginBottom: 0 }}>
            Band leaders looking for a dep see these three things together — fill them in so they can tell if you're a good fit.
          </p>

          <div className="field">
            <span className="field__label">
              Equipment you can bring
              <InfoTooltip text="Deps who can turn up with their own PA, monitors and lights are in high demand — this shows up wherever bands are looking for a dep, so tick anything you own and can bring." />
            </span>
            <EquipmentFields
              values={equipment}
              onToggle={(key, checked) => setEquipment((prev) => ({ ...prev, [key]: checked }))}
              notes={equipmentNotes}
              onNotesChange={setEquipmentNotes}
            />
          </div>

          <MyAvailability profileId={userId} />
          <MyRepertoire profileId={userId} />
        </div>
        )}
      </div>
    </>
  );
}

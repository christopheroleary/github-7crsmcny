import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import InstrumentPicker from './InstrumentPicker.jsx';
import AddressAutocomplete from './AddressAutocomplete.jsx';
import NotificationSetup from './NotificationSetup.jsx';

export default function MyProfile() {
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [homeAddress, setHomeAddress] = useState('');
  const [homeLat, setHomeLat] = useState(null);
  const [homeLon, setHomeLon] = useState(null);
  const [allInstruments, setAllInstruments] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [originalIds, setOriginalIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [userId, setUserId] = useState(null);

  useEffect(() => {
    async function load() {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData?.user?.id;
      if (!uid) return;
      setUserId(uid);
      setEmail(userData.user.email || '');

      const [{ data: profile, error: profileError }, { data: instruments }, { data: links }] = await Promise.all([
        supabase.from('profiles').select('full_name, phone, home_address, home_latitude, home_longitude').eq('id', uid).single(),
        supabase.from('instruments').select('id, name').order('sort_order'),
        supabase.from('profile_instruments').select('instrument_id').eq('profile_id', uid),
      ]);

      if (profileError) setError(profileError.message);
      else {
        setFullName(profile.full_name || '');
        setPhone(profile.phone || '');
        setHomeAddress(profile.home_address || '');
        setHomeLat(profile.home_latitude ?? null);
        setHomeLon(profile.home_longitude ?? null);
      }
      setAllInstruments(instruments || []);
      const ids = (links || []).map((l) => l.instrument_id);
      setSelectedIds(ids);
      setOriginalIds(ids);
      setLoading(false);
    }
    load();
  }, []);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);

    const toAdd = selectedIds.filter((id) => !originalIds.includes(id));
    const toRemove = originalIds.filter((id) => !selectedIds.includes(id));

    const { error: profileError } = await supabase
      .from('profiles')
      .update({
        full_name: fullName,
        phone: phone || null,
        home_address: homeAddress || null,
        home_latitude: homeLat,
        home_longitude: homeLon,
      })
      .eq('id', userId);

    let writeError = profileError;

    if (!writeError && toAdd.length > 0) {
      const { error } = await supabase
        .from('profile_instruments')
        .insert(toAdd.map((instrument_id) => ({ profile_id: userId, instrument_id })));
      writeError = error;
    }
    if (!writeError && toRemove.length > 0) {
      const { error } = await supabase
        .from('profile_instruments')
        .delete()
        .eq('profile_id', userId)
        .in('instrument_id', toRemove);
      writeError = error;
    }

    setSaving(false);
    if (writeError) setError(writeError.message);
    else {
      setOriginalIds(selectedIds);
      setSaved(true);
    }
  }

  if (loading) return <p className="state-message">Loading profile…</p>;

  return (
    <form className="entity-form" onSubmit={handleSave}>
      <h2 className="section-header__title">My profile</h2>

      <label className="field">
        <span className="field__label">Email</span>
        <input value={email} disabled />
        <span className="field__hint">Login email — changing it needs its own confirmation step.</span>
      </label>

      <label className="field">
        <span className="field__label">Name</span>
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
      </label>

      <label className="field">
        <span className="field__label">Phone</span>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} />
      </label>

      <label className="field">
        <span className="field__label">Home address (used for travel cost calculations)</span>
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
          placeholder="Start typing your home address…"
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
        <InstrumentPicker allInstruments={allInstruments} selectedIds={selectedIds} onChange={setSelectedIds} />
      </label>

      <div className="field">
        <span className="field__label">Notifications</span>
        <NotificationSetup />
      </div>

      {error && <p className="form-error">{error}</p>}
      {saved && <p className="form-success">Saved.</p>}

      <div className="form-actions">
        <button type="submit" className="btn btn--primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save profile'}
        </button>
      </div>
    </form>
  );
}
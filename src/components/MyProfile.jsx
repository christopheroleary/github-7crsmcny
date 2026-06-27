import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

export default function MyProfile() {
  const [loading, setLoading] = useState(true);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
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

      const [{ data: profile, error: profileError }, { data: instruments }, { data: links }] = await Promise.all([
        supabase.from('profiles').select('full_name, phone').eq('id', uid).single(),
        supabase.from('instruments').select('id, name').order('sort_order'),
        supabase.from('profile_instruments').select('instrument_id').eq('profile_id', uid),
      ]);

      if (profileError) setError(profileError.message);
      else {
        setFullName(profile.full_name || '');
        setPhone(profile.phone || '');
      }
      setAllInstruments(instruments || []);
      const ids = (links || []).map((l) => l.instrument_id);
      setSelectedIds(ids);
      setOriginalIds(ids);
      setLoading(false);
    }
    load();
  }, []);

  function addInstrument(id) {
    if (id && !selectedIds.includes(id)) setSelectedIds([...selectedIds, id]);
  }

  function removeInstrument(id) {
    setSelectedIds(selectedIds.filter((i) => i !== id));
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);

    const toAdd = selectedIds.filter((id) => !originalIds.includes(id));
    const toRemove = originalIds.filter((id) => !selectedIds.includes(id));

    const { error: profileError } = await supabase.from('profiles').update({ phone: phone || null }).eq('id', userId);
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

  const availableInstruments = allInstruments.filter((i) => !selectedIds.includes(i.id));
  const selectedInstruments = allInstruments.filter((i) => selectedIds.includes(i.id));

  return (
    <form className="entity-form" onSubmit={handleSave}>
      <h2 className="section-header__title">My profile</h2>

      <label className="field">
        <span className="field__label">Name</span>
        <input value={fullName} disabled />
      </label>

      <label className="field">
        <span className="field__label">Phone</span>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} />
      </label>

      <label className="field">
        <span className="field__label">Instruments</span>
        <div className="tag-input">
          <div className="tag-input__tags">
            {selectedInstruments.map((i) => (
              <span className="tag" key={i.id}>
                {i.name}
                <button type="button" onClick={() => removeInstrument(i.id)} aria-label={`Remove ${i.name}`}>×</button>
              </span>
            ))}
          </div>
          <select value="" onChange={(e) => addInstrument(e.target.value)}>
            <option value="">+ Add an instrument…</option>
            {availableInstruments.map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </select>
        </div>
      </label>

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
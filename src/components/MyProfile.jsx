import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

export default function MyProfile() {
  const [loading, setLoading] = useState(true);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [instruments, setInstruments] = useState([]);
  const [instrumentInput, setInstrumentInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    async function load() {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;
      if (!userId) return;

      const { data, error } = await supabase
        .from('profiles')
        .select('full_name, phone, instruments_played')
        .eq('id', userId)
        .single();

      if (error) setError(error.message);
      else {
        setFullName(data.full_name || '');
        setPhone(data.phone || '');
        setInstruments(data.instruments_played || []);
      }
      setLoading(false);
    }
    load();
  }, []);

  function addInstrument() {
    const trimmed = instrumentInput.trim();
    if (trimmed && !instruments.includes(trimmed)) {
      setInstruments([...instruments, trimmed]);
    }
    setInstrumentInput('');
  }

  function removeInstrument(name) {
    setInstruments(instruments.filter((i) => i !== name));
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;

    const { error } = await supabase
      .from('profiles')
      .update({ phone: phone || null, instruments_played: instruments })
      .eq('id', userId);

    setSaving(false);
    if (error) setError(error.message);
    else setSaved(true);
  }

  if (loading) return <p className="state-message">Loading profile…</p>;

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
            {instruments.map((name) => (
              <span className="tag" key={name}>
                {name}
                <button type="button" onClick={() => removeInstrument(name)} aria-label={`Remove ${name}`}>
                  ×
                </button>
              </span>
            ))}
          </div>
          <input
            value={instrumentInput}
            onChange={(e) => setInstrumentInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                addInstrument();
              }
            }}
            placeholder="Type an instrument, press Enter"
          />
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
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';

export default function BandMembers({ bandId, isAdmin }) {
  const [members, setMembers] = useState([]);
  const [musicians, setMusicians] = useState([]);
  const [instruments, setInstruments] = useState([]);
  const [musicianInstruments, setMusicianInstruments] = useState({});
  const [newMusicianId, setNewMusicianId] = useState('');
  const [newInstrumentId, setNewInstrumentId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: memberRows }, { data: profiles }, { data: insts }, { data: links }] = await Promise.all([
      supabase
        .from('band_members')
        .select('id, profile_id, instrument_id, profiles(full_name), instruments(name)')
        .eq('band_id', bandId),
      supabase.from('profiles').select('id, full_name').eq('is_active', true).order('full_name'),
      supabase.from('instruments').select('id, name').order('sort_order'),
      supabase.from('profile_instruments').select('profile_id, instrument_id, instruments(name)'),
    ]);
    setMembers(memberRows || []);
    setMusicians(profiles || []);
    setInstruments(insts || []);

    const map = {};
    (links || []).forEach((l) => {
      if (!map[l.profile_id]) map[l.profile_id] = [];
      map[l.profile_id].push({ id: l.instrument_id, name: l.instruments?.name });
    });
    setMusicianInstruments(map);
    setLoading(false);
  }, [bandId]);

  useEffect(() => {
    load();
  }, [load]);

  function handleMusicianChange(id) {
    setNewMusicianId(id);
    setNewInstrumentId('');
  }

  async function handleAdd(e) {
    e.preventDefault();
    if (!newMusicianId || !newInstrumentId) return;
    setError(null);
    const { error } = await supabase
      .from('band_members')
      .insert({ band_id: bandId, profile_id: newMusicianId, instrument_id: newInstrumentId });
    if (error) {
      setError(error.message);
      return;
    }
    setNewMusicianId('');
    setNewInstrumentId('');
    load();
  }

  async function handleRemove(member) {
    const ok = window.confirm('Remove ' + member.profiles?.full_name + ' from this band?');
    if (!ok) return;
    const { error } = await supabase.from('band_members').delete().eq('id', member.id);
    if (error) {
      alert("Couldn't remove: " + error.message);
      return;
    }
    load();
  }

  if (loading) return <p className="state-message">Loading members…</p>;

  const pickedInstruments = newMusicianId ? musicianInstruments[newMusicianId] || [] : [];
  const availableInstruments = pickedInstruments.length > 0 ? pickedInstruments : instruments;

  return (
    <div className="band-members">
      <ul className="simple-list">
        {members.length === 0 && <li className="state-message">No members yet.</li>}
        {members.map((m) => (
          <li className="simple-list__item" key={m.id}>
            <div className="simple-list__row">
              <span className="simple-list__title">{m.profiles?.full_name}</span>
              <div className="simple-list__actions">
                <span className="tag">{m.instruments?.name}</span>
                {isAdmin && (
                  <button className="link-button link-button--danger" onClick={() => handleRemove(m)}>Remove</button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {isAdmin && (
        <form className="inline-subform" onSubmit={handleAdd}>
          <select value={newMusicianId} onChange={(e) => handleMusicianChange(e.target.value)} required>
            <option value="">Choose musician…</option>
            {musicians.map((p) => (
              <option key={p.id} value={p.id}>{p.full_name}</option>
            ))}
          </select>
          <select value={newInstrumentId} onChange={(e) => setNewInstrumentId(e.target.value)} required disabled={!newMusicianId}>
            <option value="">{newMusicianId ? 'Choose instrument…' : 'Pick a musician first'}</option>
            {availableInstruments.map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </select>
          {error && <p className="form-error">{error}</p>}
          <button type="submit" className="btn btn--primary btn--small">+ Add to band</button>
        </form>
      )}
    </div>
  );
}
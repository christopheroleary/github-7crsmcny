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
  const [addMode, setAddMode] = useState('musician'); // 'musician' | 'dep'
  const [depName, setDepName] = useState('');
  const [allPlaceholders, setAllPlaceholders] = useState([]);

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
      supabase.from('placeholder_musicians').select('id, name, placeholder_musician_instruments(instrument_id, instruments(name))').is('merged_into', null),
    ]);
    setMembers(memberRows || []);
    setMusicians(profiles || []);
    setInstruments(insts || []);
    setAllPlaceholders(placeholderData || []);

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
              <span className="simple-list__title">
                {m.profiles?.full_name || m.placeholder_musicians?.name || '—'}
                {!m.profile_id && <span className="status-tag" style={{ marginLeft: 6, fontSize: 10 }}>dep</span>}
              </span>
                {isAdmin && (
                  <button className="link-button link-button--danger" onClick={() => handleRemove(m)}>Remove</button>
                )}
              </div>
          </li>
        ))}
      </ul>

{isAdmin && (
  <div className="inline-subform" style={{ marginTop: 10 }}>
    <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
      <button type="button" className={addMode === 'musician' ? 'btn btn--primary btn--small' : 'btn btn--ghost btn--small'}
        onClick={() => setAddMode('musician')}>Registered musician</button>
      <button type="button" className={addMode === 'dep' ? 'btn btn--primary btn--small' : 'btn btn--ghost btn--small'}
        onClick={() => setAddMode('dep')}>Dep / session</button>
    </div>
    {addMode === 'musician' ? (
      <form onSubmit={handleAdd} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <select value={newMusicianId} onChange={(e) => handleMusicianChange(e.target.value)} required>
          <option value="">Choose musician…</option>
          {musicians.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
        </select>
        <select value={newInstrumentId} onChange={(e) => setNewInstrumentId(e.target.value)} required disabled={!newMusicianId}>
          <option value="">{newMusicianId ? 'Choose instrument…' : 'Pick musician first'}</option>
          {availableInstruments.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="btn btn--primary btn--small">+ Add to band</button>
      </form>
    ) : (
      <form onSubmit={async (e) => {
        e.preventDefault();
        if (!newMusicianId || !newInstrumentId) return;
        const { error } = await supabase.from('band_members').insert({
          band_id: bandId, profile_id: null, placeholder_id: newMusicianId, instrument_id: newInstrumentId,
        });
        if (error) { setError(error.message); return; }
        setNewMusicianId(''); setNewInstrumentId(''); setDepName('');
        load();
      }} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <select value={newMusicianId} onChange={(e) => { setNewMusicianId(e.target.value); setNewInstrumentId(''); }} required>
          <option value="">Choose dep…</option>
          {allPlaceholders.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {newMusicianId && (
          <select value={newInstrumentId} onChange={(e) => setNewInstrumentId(e.target.value)} required>
            <option value="">Choose instrument…</option>
            {(allPlaceholders.find(p => p.id === newMusicianId)?.placeholder_musician_instruments || [])
              .map(pi => <option key={pi.instrument_id} value={pi.instrument_id}>{pi.instruments?.name}</option>)}
          </select>
        )}
        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="btn btn--primary btn--small">+ Add dep to band</button>
   </form>
    )} 
  </div>
)}
</div>
)}
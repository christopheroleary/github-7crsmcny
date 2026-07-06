import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';

export default function BandMembers({ bandId, isAdmin }) {
  const [members, setMembers] = useState([]);
  const [musicians, setMusicians] = useState([]);
  const [allPlaceholders, setAllPlaceholders] = useState([]);
  const [instruments, setInstruments] = useState([]);
  const [musicianInstruments, setMusicianInstruments] = useState({});
  const [addMode, setAddMode] = useState('musician');
  const [newMusicianId, setNewMusicianId] = useState('');
  const [newInstrumentId, setNewInstrumentId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [
      { data: memberRows },
      { data: profiles },
      { data: insts },
      { data: links },
      { data: placeholders },
      { data: phInsts },
    ] = await Promise.all([
      supabase
        .from('band_members')
        .select('id, profile_id, placeholder_id, instrument_id, profiles(full_name), placeholder_musicians(name), instruments(name)')
        .eq('band_id', bandId),
      supabase.from('profiles').select('id, full_name').eq('is_active', true).order('full_name'),
      supabase.from('instruments').select('id, name').order('sort_order'),
      supabase.from('profile_instruments').select('profile_id, instrument_id, instruments(name)'),
      supabase.from('placeholder_musicians').select('id, name').is('merged_into', null).order('name'),
      supabase.from('placeholder_musician_instruments').select('placeholder_id, instrument_id, instruments(name)'),
    ]);

    setMembers(memberRows || []);
    setMusicians(profiles || []);
    setInstruments(insts || []);

    // Map profile instruments
    const map = {};
    (links || []).forEach((l) => {
      if (!map[l.profile_id]) map[l.profile_id] = [];
      map[l.profile_id].push({ id: l.instrument_id, name: l.instruments?.name });
    });
    setMusicianInstruments(map);

    // Attach instruments to placeholders
    const phWithInsts = (placeholders || []).map((p) => ({
      ...p,
      instrumentOptions: (phInsts || [])
        .filter((pi) => pi.placeholder_id === p.id)
        .map((pi) => ({ id: pi.instrument_id, name: pi.instruments?.name })),
    }));
    setAllPlaceholders(phWithInsts);
    setLoading(false);
  }, [bandId]);

  useEffect(() => {
    load();
  }, [load]);

  function handleMusicianChange(id) {
    setNewMusicianId(id);
    setNewInstrumentId('');
  }

  async function handleAddMusician(e) {
    e.preventDefault();
    if (!newMusicianId || !newInstrumentId) return;
    setError(null);
    const { error } = await supabase.from('band_members').insert({
      band_id: bandId,
      profile_id: newMusicianId,
      placeholder_id: null,
      instrument_id: newInstrumentId,
    });
    if (error) { setError(error.message); return; }
    setNewMusicianId('');
    setNewInstrumentId('');
    load();
  }

  async function handleAddDep(e) {
    e.preventDefault();
    if (!newMusicianId || !newInstrumentId) return;
    setError(null);
    const { error } = await supabase.from('band_members').insert({
      band_id: bandId,
      profile_id: null,
      placeholder_id: newMusicianId,
      instrument_id: newInstrumentId,
    });
    if (error) { setError(error.message); return; }
    setNewMusicianId('');
    setNewInstrumentId('');
    load();
  }

  async function handleRemove(member) {
    const name = member.profiles?.full_name || member.placeholder_musicians?.name || 'this member';
    const ok = window.confirm('Remove ' + name + ' from this band?');
    if (!ok) return;
    const { error } = await supabase.from('band_members').delete().eq('id', member.id);
    if (error) { alert("Couldn't remove: " + error.message); return; }
    load();
  }

  if (loading) return <p className="state-message">Loading members…</p>;

  const pickedInstruments = newMusicianId
    ? addMode === 'musician'
      ? musicianInstruments[newMusicianId] || []
      : allPlaceholders.find((p) => p.id === newMusicianId)?.instrumentOptions || []
    : [];
  const availableInstruments = pickedInstruments.length > 0 ? pickedInstruments : instruments;

  return (
    <div className="band-members">
      <ul className="simple-list">
        {members.length === 0 && (
          <li className="state-message">No members yet.</li>
        )}
        {members.map((m) => {
          const isDepRow = !m.profile_id;
          const displayName = m.profiles?.full_name || m.placeholder_musicians?.name || '—';
          return (
            <li className="simple-list__item" key={m.id}>
              <div className="simple-list__row">
                <div>
                  <span className="simple-list__title">
                    {displayName}
                    {isDepRow && (
                      <span className="status-tag" style={{ marginLeft: 8, fontSize: 10, background: 'rgba(107,99,87,0.12)', color: 'var(--text-muted)' }}>
                        dep
                      </span>
                    )}
                  </span>
                  {m.instruments?.name && (
                    <span className="simple-list__subtitle">{m.instruments.name}</span>
                  )}
                </div>
                <div className="simple-list__actions">
                  {isAdmin && (
                    <button className="link-button link-button--danger" onClick={() => handleRemove(m)}>
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {isAdmin && (
        <div className="inline-subform" style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <button
              type="button"
              className={addMode === 'musician' ? 'btn btn--primary btn--small' : 'btn btn--ghost btn--small'}
              onClick={() => { setAddMode('musician'); setNewMusicianId(''); setNewInstrumentId(''); }}
            >
              Registered musician
            </button>
            <button
              type="button"
              className={addMode === 'dep' ? 'btn btn--primary btn--small' : 'btn btn--ghost btn--small'}
              onClick={() => { setAddMode('dep'); setNewMusicianId(''); setNewInstrumentId(''); }}
            >
              Dep / session
            </button>
          </div>

          {addMode === 'musician' ? (
            <form onSubmit={handleAddMusician} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <select
                value={newMusicianId}
                onChange={(e) => handleMusicianChange(e.target.value)}
                required
              >
                <option value="">Choose musician…</option>
                {musicians.map((p) => (
                  <option key={p.id} value={p.id}>{p.full_name}</option>
                ))}
              </select>
              <select
                value={newInstrumentId}
                onChange={(e) => setNewInstrumentId(e.target.value)}
                required
                disabled={!newMusicianId}
              >
                <option value="">
                  {newMusicianId ? 'Choose instrument…' : 'Pick a musician first'}
                </option>
                {availableInstruments.map((i) => (
                  <option key={i.id} value={i.id}>{i.name}</option>
                ))}
              </select>
              {newMusicianId && pickedInstruments.length === 0 && (
                <p className="field__hint">
                  This musician hasn't set instruments on their profile yet — showing all instruments.
                </p>
              )}
              {error && <p className="form-error">{error}</p>}
              <button type="submit" className="btn btn--primary btn--small">
                + Add to band
              </button>
            </form>
          ) : (
            <form onSubmit={handleAddDep} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {allPlaceholders.length === 0 ? (
                <p className="field__hint">
                  No deps in the system yet — add them from a gig's roster first.
                </p>
              ) : (
                <>
                  <select
                    value={newMusicianId}
                    onChange={(e) => { setNewMusicianId(e.target.value); setNewInstrumentId(''); }}
                    required
                  >
                    <option value="">Choose dep…</option>
                    {allPlaceholders.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  {newMusicianId && (
                    <select
                      value={newInstrumentId}
                      onChange={(e) => setNewInstrumentId(e.target.value)}
                      required
                    >
                      <option value="">Choose instrument…</option>
                      {pickedInstruments.length > 0
                        ? pickedInstruments.map((i) => (
                            <option key={i.id} value={i.id}>{i.name}</option>
                          ))
                        : instruments.map((i) => (
                            <option key={i.id} value={i.id}>{i.name}</option>
                          ))
                      }
                    </select>
                  )}
                  {newMusicianId && pickedInstruments.length === 0 && (
                    <p className="field__hint">
                      No instruments set for this dep yet — go to Musicians tab to add them.
                    </p>
                  )}
                  {error && <p className="form-error">{error}</p>}
                  <button type="submit" className="btn btn--primary btn--small">
                    + Add dep to band
                  </button>
                </>
              )}
            </form>
          )}
        </div>
      )}
    </div>
  );
}
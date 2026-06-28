import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useCurrentProfile } from '../hooks/useCurrentProfile.js';

export default function GigRoster({ gigId }) {
  const { profile: me, isAdmin } = useCurrentProfile();
  const [requirements, setRequirements] = useState([]);
  const [lineup, setLineup] = useState([]);
  const [musicians, setMusicians] = useState([]);
  const [instruments, setInstruments] = useState([]);
  const [musicianInstruments, setMusicianInstruments] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [newMusicianId, setNewMusicianId] = useState('');
  const [newInstrumentId, setNewInstrumentId] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: reqs }, { data: lineupRows }, { data: profiles }, { data: insts }, { data: links }] = await Promise.all([
      supabase.from('gig_requirements').select('instrument_id, quantity, instruments(name)').eq('gig_id', gigId),
      supabase
        .from('gig_lineup')
        .select('id, profile_id, instrument_id, confirmed, role_on_gig, profiles(full_name), instruments(name)')
        .eq('gig_id', gigId),
      supabase.from('profiles').select('id, full_name').eq('is_active', true).order('full_name'),
      supabase.from('instruments').select('id, name').order('sort_order'),
      supabase.from('profile_instruments').select('profile_id, instrument_id, instruments(name)'),
    ]);

    setRequirements(reqs || []);
    setLineup(lineupRows || []);
    setMusicians(profiles || []);
    setInstruments(insts || []);

    const map = {};
    (links || []).forEach((l) => {
      if (!map[l.profile_id]) map[l.profile_id] = [];
      map[l.profile_id].push({ id: l.instrument_id, name: l.instruments?.name });
    });
    setMusicianInstruments(map);

    setLoading(false);
  }, [gigId]);

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
    setAdding(true);
    setError(null);
    const { error } = await supabase
      .from('gig_lineup')
      .insert({ gig_id: gigId, profile_id: newMusicianId, instrument_id: newInstrumentId, confirmed: false });
    setAdding(false);
    if (error) {
      setError(error.message);
      return;
    }
    setNewMusicianId('');
    setNewInstrumentId('');
    load();
  }

  async function handleRemove(entry) {
    const ok = window.confirm('Remove ' + entry.profiles?.full_name + " from this gig's lineup?");
    if (!ok) return;
    const { error } = await supabase.from('gig_lineup').delete().eq('id', entry.id);
    if (error) {
      alert("Couldn't remove: " + error.message);
      return;
    }
    load();
  }

  async function handleConfirm(entry) {
    const { error } = await supabase.from('gig_lineup').update({ confirmed: true }).eq('id', entry.id);
    if (error) {
      alert("Couldn't confirm: " + error.message);
      return;
    }
    load();
  }

  if (loading) return <p className="state-message">Loading roster…</p>;

  const filledCounts = {};
  lineup.forEach((l) => {
    if (l.instrument_id) filledCounts[l.instrument_id] = (filledCounts[l.instrument_id] || 0) + 1;
  });

  const pickedMusicianInstruments = newMusicianId ? musicianInstruments[newMusicianId] || [] : [];
  const availableInstrumentsForPicked = pickedMusicianInstruments.length > 0 ? pickedMusicianInstruments : instruments;

  return (
    <div className="roster-section">
      <h3 className="roster-section__title">Roster &amp; vacancies</h3>

      {requirements.length > 0 && (
        <ul className="vacancy-list">
          {requirements.map((r, i) => {
            const filled = filledCounts[r.instrument_id] || 0;
            const vacant = Math.max(0, r.quantity - filled);
            return (
              <li key={i} className={vacant > 0 ? 'vacancy-list__item vacancy-list__item--open' : 'vacancy-list__item'}>
                <span>{r.instruments?.name}</span>
                <span>
                  {filled}/{r.quantity} filled{vacant > 0 ? ' — need ' + vacant + ' more' : ''}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <ul className="simple-list">
        {lineup.length === 0 && <li className="state-message">Nobody booked yet.</li>}
        {lineup.map((entry) => {
          const isMe = entry.profile_id === me?.id;
          return (
            <li className="simple-list__item" key={entry.id}>
              <div className="simple-list__row">
                <div>
                  <span className="simple-list__title">{entry.profiles?.full_name}</span>
                  <span className="simple-list__subtitle">{entry.instruments?.name || entry.role_on_gig || '—'}</span>
                </div>
                <div className="simple-list__actions">
                  <span className={entry.confirmed ? 'status-tag status-tag--confirmed' : 'status-tag status-tag--inquiry'}>
                    {entry.confirmed ? 'Confirmed' : 'Pending'}
                  </span>
                  {!entry.confirmed && (isMe || isAdmin) && (
                    <button className="link-button" onClick={() => handleConfirm(entry)}>Confirm</button>
                  )}
                  {isAdmin && (
                    <button className="link-button link-button--danger" onClick={() => handleRemove(entry)}>Remove</button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {isAdmin && (
        <form className="inline-subform" onSubmit={handleAdd}>
          <select value={newMusicianId} onChange={(e) => handleMusicianChange(e.target.value)} required>
            <option value="">Choose musician…</option>
            {musicians.map((m) => (
              <option key={m.id} value={m.id}>{m.full_name}</option>
            ))}
          </select>
          <select
            value={newInstrumentId}
            onChange={(e) => setNewInstrumentId(e.target.value)}
            required
            disabled={!newMusicianId}
          >
            <option value="">{newMusicianId ? 'Choose instrument…' : 'Pick a musician first'}</option>
            {availableInstrumentsForPicked.map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </select>
          {newMusicianId && pickedMusicianInstruments.length === 0 && (
            <p className="state-message" style={{ padding: '4px 0', textAlign: 'left' }}>
              This musician hasn't set any instruments on their profile yet — showing all instruments instead.
            </p>
          )}
          {error && <p className="form-error">{error}</p>}
          <button type="submit" className="btn btn--primary btn--small" disabled={adding}>
            {adding ? 'Adding…' : '+ Add to roster'}
          </button>
        </form>
      )}
    </div>
  );
}
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useCurrentProfile } from '../context/ProfileContext.jsx';

export default function GigRoster({ gigId }) {
  const { profile: me, isAdmin } = useCurrentProfile();
  const [requirements, setRequirements] = useState([]);
  const [lineup, setLineup] = useState([]);
  const [musicians, setMusicians] = useState([]);
  const [placeholders, setPlaceholders] = useState([]);
  const [instruments, setInstruments] = useState([]);
  const [musicianInstruments, setMusicianInstruments] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Real musician add
  const [newMusicianId, setNewMusicianId] = useState('');
  const [newInstrumentId, setNewInstrumentId] = useState('');
  const [adding, setAdding] = useState(false);

  // Placeholder add
  const [showPlaceholder, setShowPlaceholder] = useState(false);
  const [placeholderName, setPlaceholderName] = useState('');
  const [placeholderInstrumentId, setPlaceholderInstrumentId] = useState('');
  const [addingPlaceholder, setAddingPlaceholder] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: reqs }, { data: lineupRows }, { data: profiles }, { data: insts }, { data: links }, { data: ph }] = await Promise.all([
      supabase.from('gig_requirements').select('instrument_id, quantity, instruments(name)').eq('gig_id', gigId),
      supabase.from('gig_lineup').select('id, profile_id, placeholder_id, instrument_id, confirmed, role_on_gig, profiles(full_name), instruments(name), placeholder_musicians(name)').eq('gig_id', gigId),
      supabase.from('profiles').select('id, full_name').eq('is_active', true).order('full_name'),
      supabase.from('instruments').select('id, name').order('sort_order'),
      supabase.from('profile_instruments').select('profile_id, instrument_id, instruments(name)'),
      supabase.from('placeholder_musicians').select('id, name, instrument_id, instruments(name)').is('merged_into', null),
    ]);
    setRequirements(reqs || []);
    setLineup(lineupRows || []);
    setMusicians(profiles || []);
    setInstruments(insts || []);
    setPlaceholders(ph || []);
    const map = {};
    (links || []).forEach((l) => {
      if (!map[l.profile_id]) map[l.profile_id] = [];
      map[l.profile_id].push({ id: l.instrument_id, name: l.instruments?.name });
    });
    setMusicianInstruments(map);
    setLoading(false);
  }, [gigId]);

  useEffect(() => { load(); }, [load]);

  async function handleAdd(e) {
    e.preventDefault();
    if (!newMusicianId || !newInstrumentId) return;
    setAdding(true);
    setError(null);
    const { error } = await supabase.from('gig_lineup').insert({
      gig_id: gigId, profile_id: newMusicianId, instrument_id: newInstrumentId, confirmed: false,
    });
    setAdding(false);
    if (error) { setError(error.message); return; }
    setNewMusicianId(''); setNewInstrumentId('');
    load();
  }

  async function handleAddPlaceholder(e) {
    e.preventDefault();
    if (!placeholderName.trim()) return;
    setAddingPlaceholder(true);
    setError(null);

    // Reuse existing placeholder with same name+instrument, or create new
    let phId = null;
    const existing = placeholders.find(
      (p) => p.name.toLowerCase() === placeholderName.trim().toLowerCase() &&
             p.instrument_id === (placeholderInstrumentId || null)
    );
    if (existing) {
      phId = existing.id;
    } else {
      const { data: newPh, error: phError } = await supabase
        .from('placeholder_musicians')
        .insert({ name: placeholderName.trim(), instrument_id: placeholderInstrumentId || null })
        .select().single();
      if (phError) { setError(phError.message); setAddingPlaceholder(false); return; }
      phId = newPh.id;
    }

    const { error: lineupError } = await supabase.from('gig_lineup').insert({
      gig_id: gigId,
      profile_id: null,
      placeholder_id: phId,
      instrument_id: placeholderInstrumentId || null,
      confirmed: false,
    });
    setAddingPlaceholder(false);
    if (lineupError) { setError(lineupError.message); return; }
    setPlaceholderName(''); setPlaceholderInstrumentId(''); setShowPlaceholder(false);
    load();
  }

  async function handleRemove(entry) {
    const name = entry.profiles?.full_name || entry.placeholder_musicians?.name || 'this musician';
    const ok = window.confirm('Remove ' + name + " from this gig's lineup?");
    if (!ok) return;
    const { error } = await supabase.from('gig_lineup').delete().eq('id', entry.id);
    if (error) { alert("Couldn't remove: " + error.message); return; }
    load();
  }

  async function handleConfirm(entry) {
    const { error } = await supabase.from('gig_lineup').update({ confirmed: true }).eq('id', entry.id);
    if (error) { alert("Couldn't confirm: " + error.message); return; }
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
                <span>{filled}/{r.quantity} filled{vacant > 0 ? ' — need ' + vacant + ' more' : ''}</span>
              </li>
            );
          })}
        </ul>
      )}

      <ul className="simple-list">
        {lineup.length === 0 && <li className="state-message">Nobody booked yet.</li>}
        {lineup.map((entry) => {
          const isPlaceholder = !entry.profile_id;
          const isMe = entry.profile_id === me?.id;
          const displayName = entry.profiles?.full_name || entry.placeholder_musicians?.name || 'Unknown';
          return (
            <li className="simple-list__item" key={entry.id}>
              <div className="simple-list__row">
                <div>
                  <span className="simple-list__title">
                    {displayName}
                    {isPlaceholder && <span className="status-tag" style={{ marginLeft: 8, background: 'rgba(107,99,87,0.12)', color: 'var(--text-muted)' }}>dep / session</span>}
                  </span>
                  <span className="simple-list__subtitle">{entry.instruments?.name || '—'}</span>
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
        <>
          <form className="inline-subform" onSubmit={handleAdd} style={{ marginTop: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Add registered musician</span>
            <select value={newMusicianId} onChange={(e) => { setNewMusicianId(e.target.value); setNewInstrumentId(''); }} required>
              <option value="">Choose musician…</option>
              {musicians.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
            </select>
            <select value={newInstrumentId} onChange={(e) => setNewInstrumentId(e.target.value)} required disabled={!newMusicianId}>
              <option value="">{newMusicianId ? 'Choose instrument…' : 'Pick a musician first'}</option>
              {availableInstrumentsForPicked.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
            {error && <p className="form-error">{error}</p>}
            <button type="submit" className="btn btn--primary btn--small" disabled={adding}>
              {adding ? 'Adding…' : '+ Add to roster'}
            </button>
          </form>

          {!showPlaceholder ? (
            <button className="link-button" style={{ marginTop: 8 }} onClick={() => setShowPlaceholder(true)}>
              + Add dep / session musician (not in system)
            </button>
          ) : (
            <form className="inline-subform" onSubmit={handleAddPlaceholder} style={{ marginTop: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Dep / session musician</span>
              <input
                placeholder="Name (e.g. Dave Smith)"
                value={placeholderName}
                onChange={(e) => setPlaceholderName(e.target.value)}
                required
                list="existing-placeholders"
              />
              <datalist id="existing-placeholders">
                {placeholders.map((p) => <option key={p.id} value={p.name} />)}
              </datalist>
              <select value={placeholderInstrumentId} onChange={(e) => setPlaceholderInstrumentId(e.target.value)}>
                <option value="">No instrument specified</option>
                {instruments.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
              <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
                <button type="button" className="btn btn--ghost btn--small" onClick={() => setShowPlaceholder(false)}>Cancel</button>
                <button type="submit" className="btn btn--primary btn--small" disabled={addingPlaceholder}>
                  {addingPlaceholder ? 'Adding…' : '+ Add dep'}
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </div>
  );
}



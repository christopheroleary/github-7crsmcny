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

  // Placeholder / dep add
  const [showPlaceholder, setShowPlaceholder] = useState(false);
  const [placeholderMode, setPlaceholderMode] = useState('existing'); // 'existing' | 'new'
  const [selectedPlaceholderId, setSelectedPlaceholderId] = useState('');
  const [placeholderInstrumentId, setPlaceholderInstrumentId] = useState('');
  const [newDepName, setNewDepName] = useState('');
  const [newDepInstrumentId, setNewDepInstrumentId] = useState('');
  const [addingPlaceholder, setAddingPlaceholder] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [
      { data: reqs },
      { data: lineupRows },
      { data: profiles },
      { data: insts },
      { data: links },
      { data: ph },
      { data: phInsts },
    ] = await Promise.all([
      supabase.from('gig_requirements').select('instrument_id, quantity, instruments(name)').eq('gig_id', gigId),
      supabase.from('gig_lineup').select('id, profile_id, placeholder_id, instrument_id, confirmed, role_on_gig, profiles(full_name), instruments(name), placeholder_musicians(name)').eq('gig_id', gigId),
      supabase.from('profiles').select('id, full_name').eq('is_active', true).order('full_name'),
      supabase.from('instruments').select('id, name').order('sort_order'),
      supabase.from('profile_instruments').select('profile_id, instrument_id, instruments(name)'),
      supabase.from('placeholder_musicians').select('id, name').is('merged_into', null).order('name'),
      supabase.from('placeholder_musician_instruments').select('placeholder_id, instrument_id, instruments(name)'),
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

    // Attach instruments to each placeholder
    const phWithInsts = (ph || []).map((p) => ({
      ...p,
      knownInstruments: (phInsts || [])
        .filter((pi) => pi.placeholder_id === p.id)
        .map((pi) => ({ id: pi.instrument_id, name: pi.instruments?.name }))
        .filter((i) => i.name),
    }));
    setPlaceholders(phWithInsts);
    setLoading(false);
  }, [gigId]);

  useEffect(() => { load(); }, [load]);

  // ── Add registered musician ──────────────────────────────────────────────
  async function handleAdd(e) {
    e.preventDefault();
    if (!newMusicianId || !newInstrumentId) return;
    setAdding(true);
    setError(null);

    // Prevent duplicate
    if (lineup.some((l) => l.profile_id === newMusicianId)) {
      setError('This musician is already on the roster.');
      setAdding(false);
      return;
    }

    const { error } = await supabase.from('gig_lineup').insert({
      gig_id: gigId,
      profile_id: newMusicianId,
      placeholder_id: null,
      instrument_id: newInstrumentId,
      confirmed: false,
    });
    setAdding(false);
    if (error) { setError(error.message); return; }
    setNewMusicianId('');
    setNewInstrumentId('');
    load();
  }

  // ── Add existing dep ─────────────────────────────────────────────────────
  async function handleAddExistingDep(e) {
    e.preventDefault();
    if (!selectedPlaceholderId || !placeholderInstrumentId) return;
    setAddingPlaceholder(true);
    setError(null);

    // Prevent duplicate
    if (lineup.some((l) => l.placeholder_id === selectedPlaceholderId)) {
      setError('This dep is already on the roster.');
      setAddingPlaceholder(false);
      return;
    }

    // Auto-save instrument to their profile if not already there
    await supabase.from('placeholder_musician_instruments')
      .upsert({ placeholder_id: selectedPlaceholderId, instrument_id: placeholderInstrumentId }, { onConflict: 'placeholder_id,instrument_id', ignoreDuplicates: true });

    const { error } = await supabase.from('gig_lineup').insert({
      gig_id: gigId,
      profile_id: null,
      placeholder_id: selectedPlaceholderId,
      instrument_id: placeholderInstrumentId,
      confirmed: false,
    });
    setAddingPlaceholder(false);
    if (error) { setError(error.message); return; }
    setSelectedPlaceholderId('');
    setPlaceholderInstrumentId('');
    setShowPlaceholder(false);
    load();
  }

  // ── Add brand new dep ────────────────────────────────────────────────────
  async function handleAddNewDep(e) {
    e.preventDefault();
    if (!newDepName.trim() || !newDepInstrumentId) return;
    setAddingPlaceholder(true);
    setError(null);

    // Check if placeholder with same name already exists
    const existingPh = placeholders.find(
      (p) => p.name.trim().toLowerCase() === newDepName.trim().toLowerCase()
    );

    let phId;
    if (existingPh) {
      phId = existingPh.id;
    } else {
      const { data: newPh, error: phErr } = await supabase
        .from('placeholder_musicians')
        .insert({ name: newDepName.trim() })
        .select()
        .single();
      if (phErr) { setError(phErr.message); setAddingPlaceholder(false); return; }
      phId = newPh.id;
    }

    // Prevent duplicate on roster
    if (lineup.some((l) => l.placeholder_id === phId)) {
      setError((existingPh ? existingPh.name : newDepName) + ' is already on the roster.');
      setAddingPlaceholder(false);
      return;
    }

    // Save instrument to their profile
    await supabase.from('placeholder_musician_instruments')
      .upsert({ placeholder_id: phId, instrument_id: newDepInstrumentId }, { onConflict: 'placeholder_id,instrument_id', ignoreDuplicates: true });

    const { error } = await supabase.from('gig_lineup').insert({
      gig_id: gigId,
      profile_id: null,
      placeholder_id: phId,
      instrument_id: newDepInstrumentId,
      confirmed: false,
    });
    setAddingPlaceholder(false);
    if (error) { setError(error.message); return; }
    setNewDepName('');
    setNewDepInstrumentId('');
    setShowPlaceholder(false);
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

  // Instruments available for selected registered musician
  const pickedMusicianInstruments = newMusicianId ? musicianInstruments[newMusicianId] || [] : [];
  const availableForMusician = pickedMusicianInstruments.length > 0 ? pickedMusicianInstruments : instruments;

  // Instruments available for selected existing dep — ONLY their known instruments, never all
  const selectedDepData = selectedPlaceholderId ? placeholders.find((p) => p.id === selectedPlaceholderId) : null;
  const availableForDep = selectedDepData?.knownInstruments?.length > 0
    ? selectedDepData.knownInstruments
    : instruments; // Fallback to all only if none set yet

  // Already-on-roster IDs for filtering dropdowns
  const rosteredProfileIds = lineup.filter((l) => l.profile_id).map((l) => l.profile_id);
  const rosteredPlaceholderIds = lineup.filter((l) => l.placeholder_id).map((l) => l.placeholder_id);

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
                    {isPlaceholder && (
                      <span className="status-tag" style={{ marginLeft: 8, background: 'rgba(107,99,87,0.12)', color: 'var(--text-muted)' }}>
                        dep
                      </span>
                    )}
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
        <div style={{ marginTop: 16 }}>
          {error && <p className="form-error" style={{ marginBottom: 8 }}>{error}</p>}

          {/* Add registered musician */}
          <form className="inline-subform" onSubmit={handleAdd} style={{ marginBottom: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Add registered musician
            </span>
            <select
              value={newMusicianId}
              onChange={(e) => { setNewMusicianId(e.target.value); setNewInstrumentId(''); }}
              required
            >
              <option value="">Choose musician…</option>
              {musicians
                .filter((m) => !rosteredProfileIds.includes(m.id))
                .map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
            </select>
            <select
              value={newInstrumentId}
              onChange={(e) => setNewInstrumentId(e.target.value)}
              required
              disabled={!newMusicianId}
            >
              <option value="">{newMusicianId ? 'Choose instrument…' : 'Pick a musician first'}</option>
              {availableForMusician.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
            {newMusicianId && pickedMusicianInstruments.length === 0 && (
              <p className="field__hint">No instruments on profile — showing all.</p>
            )}
            <button type="submit" className="btn btn--primary btn--small" disabled={adding}>
              {adding ? 'Adding…' : '+ Add to roster'}
            </button>
          </form>

          {/* Add dep */}
          {!showPlaceholder ? (
            <button className="link-button" onClick={() => { setShowPlaceholder(true); setPlaceholderMode('existing'); }}>
              + Add dep / session musician
            </button>
          ) : (
            <div className="inline-subform">
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Add dep / session musician
              </span>

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className={placeholderMode === 'existing' ? 'btn btn--primary btn--small' : 'btn btn--ghost btn--small'}
                  onClick={() => { setPlaceholderMode('existing'); setSelectedPlaceholderId(''); setPlaceholderInstrumentId(''); }}
                >
                  Existing dep
                </button>
                <button
                  type="button"
                  className={placeholderMode === 'new' ? 'btn btn--primary btn--small' : 'btn btn--ghost btn--small'}
                  onClick={() => { setPlaceholderMode('new'); setNewDepName(''); setNewDepInstrumentId(''); }}
                >
                  New dep
                </button>
              </div>

              {placeholderMode === 'existing' ? (
                <form onSubmit={handleAddExistingDep} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {placeholders.filter((p) => !rosteredPlaceholderIds.includes(p.id)).length === 0 ? (
                    <p className="field__hint">All known deps are already on this roster. Use "New dep" to add someone new.</p>
                  ) : (
                    <>
                      <select
                        value={selectedPlaceholderId}
                        onChange={(e) => { setSelectedPlaceholderId(e.target.value); setPlaceholderInstrumentId(''); }}
                        required
                      >
                        <option value="">Choose dep…</option>
                        {placeholders
                          .filter((p) => !rosteredPlaceholderIds.includes(p.id))
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}{p.knownInstruments?.length ? ' (' + p.knownInstruments.map(i => i.name).join(', ') + ')' : ''}
                            </option>
                          ))}
                      </select>

                      {selectedPlaceholderId && (
                        <>
                          <select
                            value={placeholderInstrumentId}
                            onChange={(e) => setPlaceholderInstrumentId(e.target.value)}
                            required
                          >
                            <option value="">Choose instrument for this gig…</option>
                            {availableForDep.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                          </select>
                          {selectedDepData?.knownInstruments?.length === 0 && (
                            <p className="field__hint">No instruments saved for this dep yet — your selection will be saved to their profile.</p>
                          )}
                        </>
                      )}

                      <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
                        <button type="button" className="btn btn--ghost btn--small" onClick={() => setShowPlaceholder(false)}>Cancel</button>
                        <button type="submit" className="btn btn--primary btn--small" disabled={addingPlaceholder}>
                          {addingPlaceholder ? 'Adding…' : '+ Add dep'}
                        </button>
                      </div>
                    </>
                  )}
                </form>
              ) : (
                <form onSubmit={handleAddNewDep} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <input
                    placeholder="Full name (e.g. Dave Smith)"
                    value={newDepName}
                    onChange={(e) => setNewDepName(e.target.value)}
                    required
                  />
                  <select
                    value={newDepInstrumentId}
                    onChange={(e) => setNewDepInstrumentId(e.target.value)}
                    required
                  >
                    <option value="">Choose instrument…</option>
                    {instruments.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </select>
                  <p className="field__hint">Their instrument will be saved so you can reuse them on future gigs.</p>
                  <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
                    <button type="button" className="btn btn--ghost btn--small" onClick={() => setShowPlaceholder(false)}>Cancel</button>
                    <button type="submit" className="btn btn--primary btn--small" disabled={addingPlaceholder}>
                      {addingPlaceholder ? 'Adding…' : '+ Add new dep'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
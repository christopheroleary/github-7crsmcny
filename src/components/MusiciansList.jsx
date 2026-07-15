import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';
import MusicianEditForm from './MusicianEditForm.jsx';
import { useCurrentProfile } from '../context/ProfileContext.jsx';

export default function MusiciansList() {
  const { profile: me, isAdmin } = useCurrentProfile();
  const [musicians, setMusicians] = useState([]);
  const [allInstruments, setAllInstruments] = useState([]);
  const [filterInstrumentId, setFilterInstrumentId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [editingId, setEditingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [
      { data: profiles, error: profilesError },
      { data: links },
      { data: insts },
    ] = await Promise.all([
      supabase.from('profiles').select('id, full_name, phone, role, is_active').order('full_name'),
      supabase.from('profile_instruments').select('profile_id, instrument_id, instruments(id, name)'),
      supabase.from('instruments').select('id, name').order('sort_order'),
    ]);

    if (profilesError) {
      setError(profilesError.message);
      setLoading(false);
      return;
    }

    const withInstruments = (profiles || []).map((p) => ({
      ...p,
      instruments: (links || [])
        .filter((l) => l.profile_id === p.id)
        .map((l) => ({ id: l.instrument_id, name: l.instruments?.name }))
        .filter((i) => i.name),
    }));

    setMusicians(withInstruments);
    setAllInstruments(insts || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function handleSaved() {
    setEditingId(null);
    load();
  }

  async function handleToggleActive(musician) {
    const action = musician.is_active ? 'Deactivate' : 'Reactivate';
    const consequence = musician.is_active
      ? "They'll be hidden from active rosters but their history is kept."
      : "They'll reappear in roster selections.";
    const ok = window.confirm(action + ' ' + musician.full_name + '? ' + consequence);
    if (!ok) return;
    const { error } = await supabase.from('profiles').update({ is_active: !musician.is_active }).eq('id', musician.id);
    if (error) { alert("Couldn't update: " + error.message); return; }
    load();
  }

  // Filter musicians by instrument
  const filtered = filterInstrumentId
    ? musicians.filter((m) => m.instruments.some((i) => i.id === filterInstrumentId))
    : musicians;

  return (
    <div>
      <div className="section-header">
        <h2 className="section-header__title">Musicians</h2>
      </div>

      {/* Instrument filter */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16 }}>
        <label className="field__label" style={{ margin: 0, flexShrink: 0 }}>Filter by instrument:</label>
        <select
          value={filterInstrumentId}
          onChange={(e) => setFilterInstrumentId(e.target.value)}
          style={{ padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 14, background: 'var(--paper)', color: 'var(--ink)', maxWidth: 220 }}
        >
          <option value="">All instruments</option>
          {allInstruments.map((i) => (
            <option key={i.id} value={i.id}>{i.name}</option>
          ))}
        </select>
        {filterInstrumentId && (
          <button className="link-button" onClick={() => setFilterInstrumentId('')}>Clear</button>
        )}
        {filterInstrumentId && (
          <span className="field__hint">{filtered.length} result{filtered.length !== 1 ? 's' : ''}</span>
        )}
      </div>

      <p className="field__hint" style={{ marginBottom: 16 }}>
        New band members join by creating their own account from the login screen.
      </p>

      {loading ? (
        <p className="state-message">Loading musicians…</p>
      ) : error ? (
        <p className="state-message state-message--error">Couldn't load musicians: {error}</p>
      ) : filtered.length === 0 ? (
        <p className="state-message">
          {filterInstrumentId ? 'No musicians play that instrument yet.' : 'No musicians yet.'}
        </p>
      ) : (
        <ul className="simple-list">
          {filtered.map((m) => (
            <li className="simple-list__item" key={m.id}>
              {editingId === m.id ? (
                <MusicianEditForm profile={m} onSaved={handleSaved} onCancel={() => setEditingId(null)} />
              ) : (
                <>
                  <div className="simple-list__row">
                    <div>
                      <span className="simple-list__title">
                        {m.full_name}
                        {!m.is_active && <span className="status-tag" style={{ marginLeft: 8 }}>inactive</span>}
                        {m.id === me?.id && <span className="status-tag" style={{ marginLeft: 8 }}>you</span>}
                      </span>
                      <span className="simple-list__subtitle">
                        {m.instruments.length > 0
                          ? m.instruments.map((i) => i.name).join(', ')
                          : 'No instruments set'}
                      </span>
                    </div>
                    <div className="simple-list__actions">
                      <button className="link-button" onClick={() => setExpandedId(expandedId === m.id ? null : m.id)}>
                        {expandedId === m.id ? 'Hide' : 'View'}
                      </button>
                      {isAdmin && m.id !== me?.id && (
                        <>
                          <button className="link-button" onClick={() => setEditingId(m.id)}>Edit</button>
                          <button
                            className="link-button link-button--danger"
                            onClick={() => handleToggleActive(m)}
                          >
                            {m.is_active ? 'Deactivate' : 'Reactivate'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {expandedId === m.id && (
                    <dl className="detail-list" style={{ marginTop: 10 }}>
                      <dt>Phone</dt><dd>{m.phone || '—'}</dd>
                      <dt>Role</dt><dd>{m.role}</dd>
                      <dt>Instruments</dt><dd>{m.instruments.length > 0 ? m.instruments.map((i) => i.name).join(', ') : '—'}</dd>
                    </dl>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {isAdmin && <PlaceholdersSection />}
    </div>
  );
}

// ─── Inline editable dep name ─────────────────────────────────────────────────

function DepNameEditor({ ph, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(ph.name);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  function startEdit() {
    setValue(ph.name);
    setEditing(true);
    // Focus after render
    setTimeout(() => inputRef.current?.select(), 0);
  }

  async function commit() {
    const trimmed = value.trim();
    if (!trimmed) { setValue(ph.name); setEditing(false); return; }
    if (trimmed === ph.name) { setEditing(false); return; }
    setSaving(true);
    const { error } = await supabase
      .from('placeholder_musicians')
      .update({ name: trimmed })
      .eq('id', ph.id);
    setSaving(false);
    if (error) { alert("Couldn't rename: " + error.message); return; }
    setEditing(false);
    onSaved();
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { setValue(ph.name); setEditing(false); }
  }

  if (editing) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <input
          ref={inputRef}
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          disabled={saving}
          style={{
            fontSize: 'inherit',
            fontWeight: 'inherit',
            fontFamily: 'inherit',
            padding: '2px 6px',
            border: '1px solid var(--accent, #6366f1)',
            borderRadius: 5,
            background: 'var(--paper)',
            color: 'var(--ink)',
            outline: 'none',
            minWidth: 140,
          }}
        />
        <button
          className="link-button"
          onMouseDown={(e) => { e.preventDefault(); commit(); }}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          className="link-button"
          onMouseDown={(e) => { e.preventDefault(); setValue(ph.name); setEditing(false); }}
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span
        className="simple-list__title"
        onDoubleClick={startEdit}
        title="Double-click to rename"
        style={{ cursor: 'text' }}
      >
        {ph.name}
      </span>
      <button
        className="link-button"
        onClick={startEdit}
        style={{ fontSize: 12, opacity: 0.6 }}
        title="Rename dep"
      >
        Rename
      </button>
    </span>
  );
}

// ─── Deps / Placeholders ─────────────────────────────────────────────────────

function PlaceholdersSection() {
  const [placeholders, setPlaceholders] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [allInstruments, setAllInstruments] = useState([]);
  const [filterInstrumentId, setFilterInstrumentId] = useState('');
  const [loading, setLoading] = useState(true);
  const [mergeTargets, setMergeTargets] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: ph }, { data: pr }, { data: insts }, { data: phInsts }] = await Promise.all([
      supabase.from('placeholder_musicians').select('id, name, merged_into').order('name'),
      supabase.from('profiles').select('id, full_name').eq('is_active', true).order('full_name'),
      supabase.from('instruments').select('id, name').order('sort_order'),
      supabase.from('placeholder_musician_instruments').select('placeholder_id, instrument_id, instruments(name)'),
    ]);

    const withInsts = (ph || []).map((p) => ({
      ...p,
      instruments: (phInsts || [])
        .filter((pi) => pi.placeholder_id === p.id)
        .map((pi) => ({ id: pi.instrument_id, name: pi.instruments?.name }))
        .filter((i) => i.name),
    }));

    setPlaceholders(withInsts);
    setProfiles(pr || []);
    setAllInstruments(insts || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleAddInstrument(placeholderId, instrumentId) {
    if (!instrumentId) return;
    const { error } = await supabase.from('placeholder_musician_instruments')
      .insert({ placeholder_id: placeholderId, instrument_id: instrumentId });
    if (error) { alert("Couldn't add instrument: " + error.message); return; }
    load();
  }

  async function handleRemoveInstrument(placeholderId, instrumentId) {
    await supabase.from('placeholder_musician_instruments')
      .delete().eq('placeholder_id', placeholderId).eq('instrument_id', instrumentId);
    load();
  }

  async function handleDeleteDep(ph) {
    const ok = window.confirm('Delete "' + ph.name + '" from the system? This will also remove them from any gig rosters. This cannot be undone.');
    if (!ok) return;
    const { error } = await supabase.from('placeholder_musicians').delete().eq('id', ph.id);
    if (error) { alert("Couldn't delete: " + error.message); return; }
    load();
  }

  async function handleMerge(ph) {
    const targetId = mergeTargets[ph.id];
    if (!targetId) { alert('Pick a profile to merge into first.'); return; }
    const targetName = profiles.find((p) => p.id === targetId)?.full_name;
    const ok = window.confirm('Merge all gig history for "' + ph.name + '" into ' + targetName + '? This cannot be undone.');
    if (!ok) return;
    const { error } = await supabase.rpc('merge_placeholder_musician', {
      p_placeholder_id: ph.id,
      p_target_profile_id: targetId,
    });
    if (error) { alert("Couldn't merge: " + error.message); return; }
    load();
  }

  if (loading) return null;

  const active = placeholders.filter((p) => !p.merged_into);
  const merged = placeholders.filter((p) => p.merged_into);

  const filteredActive = filterInstrumentId
    ? active.filter((p) => p.instruments.some((i) => i.id === filterInstrumentId))
    : active;

  return (
    <div style={{ marginTop: 32 }}>
      <div className="section-header">
        <h2 className="section-header__title">Deps &amp; session musicians</h2>
      </div>

      {/* Instrument filter for deps */}
      {active.length > 0 && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16 }}>
          <label className="field__label" style={{ margin: 0, flexShrink: 0 }}>Filter by instrument:</label>
          <select
            value={filterInstrumentId}
            onChange={(e) => setFilterInstrumentId(e.target.value)}
            style={{ padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 14, background: 'var(--paper)', color: 'var(--ink)', maxWidth: 220 }}
          >
            <option value="">All instruments</option>
            {allInstruments.map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </select>
          {filterInstrumentId && (
            <button className="link-button" onClick={() => setFilterInstrumentId('')}>Clear</button>
          )}
        </div>
      )}

      <p className="field__hint" style={{ marginBottom: 16 }}>
        Deps are created automatically when added to a gig roster. Instruments added to a gig are saved here automatically.
      </p>

      {active.length === 0 ? (
        <p className="state-message">No deps in the system yet — add them from a gig's roster.</p>
      ) : filteredActive.length === 0 ? (
        <p className="state-message">No deps play that instrument.</p>
      ) : (
        <ul className="simple-list">
          {filteredActive.map((ph) => (
            <li className="simple-list__item" key={ph.id}>
              <div className="simple-list__row" style={{ alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  {/* Editable name — double-click or click Rename */}
                  <DepNameEditor ph={ph} onSaved={load} />

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                    {ph.instruments.map((inst) => (
                      <span className="tag" key={inst.id}>
                        {inst.name}
                        <button
                          type="button"
                          onClick={() => handleRemoveInstrument(ph.id, inst.id)}
                          aria-label={'Remove ' + inst.name}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    <select
                      value=""
                      style={{ fontSize: 12, padding: '3px 6px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--paper)' }}
                      onChange={(e) => handleAddInstrument(ph.id, e.target.value)}
                    >
                      <option value="">+ Add instrument…</option>
                      {allInstruments
                        .filter((i) => !ph.instruments.find((pi) => pi.id === i.id))
                        .map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                    </select>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end', flexShrink: 0 }}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <select
                      value={mergeTargets[ph.id] || ''}
                      onChange={(e) => setMergeTargets((prev) => ({ ...prev, [ph.id]: e.target.value }))}
                      style={{ fontSize: 12, padding: '4px 6px', border: '1px solid var(--line)', borderRadius: 6 }}
                    >
                      <option value="">Merge into real account…</option>
                      {profiles.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                    </select>
                    <button className="link-button" onClick={() => handleMerge(ph)}>Merge</button>
                  </div>
                  <button className="link-button link-button--danger" style={{ fontSize: 12 }} onClick={() => handleDeleteDep(ph)}>
                    Delete dep
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {merged.length > 0 && (
        <details style={{ marginTop: 16 }}>
          <summary className="link-button" style={{ cursor: 'pointer', userSelect: 'none' }}>
            Show {merged.length} merged dep{merged.length > 1 ? 's' : ''}
          </summary>
          <ul className="simple-list" style={{ marginTop: 8 }}>
            {merged.map((ph) => {
              const target = profiles.find((p) => p.id === ph.merged_into);
              return (
                <li className="simple-list__item" key={ph.id}>
                  <span className="simple-list__title" style={{ color: 'var(--text-muted)' }}>{ph.name}</span>
                  <span className="simple-list__subtitle">→ merged into {target?.full_name || 'unknown account'}</span>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </div>
  );
}
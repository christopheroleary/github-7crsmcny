import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import MusicianEditForm from './MusicianEditForm.jsx';
import { useCurrentProfile } from '../context/ProfileContext.jsx';

export default function MusiciansList() {
  const { profile: me, isAdmin } = useCurrentProfile();
  const [musicians, setMusicians] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [editingId, setEditingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, full_name, phone, role, is_active')
      .order('full_name');
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    const { data: links } = await supabase.from('profile_instruments').select('profile_id, instruments(name)');

    const withInstruments = (profiles || []).map((p) => ({
      ...p,
      instruments: (links || []).filter((l) => l.profile_id === p.id).map((l) => l.instruments?.name),
    }));
    setMusicians(withInstruments);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function handleSaved() {
    setEditingId(null);
    load();
  }

  async function handleToggleActive(musician) {
    const ok = window.confirm(
      musician.is_active
        ? `Deactivate ${musician.full_name}? They'll be hidden from active rosters but their history is kept, and you can reactivate them anytime.`
        : `Reactivate ${musician.full_name}?`
    );
    if (!ok) return;
    const { error } = await supabase.from('profiles').update({ is_active: !musician.is_active }).eq('id', musician.id);
    if (error) {
      alert(`Couldn't update: ${error.message}`);
      return;
    }
    load();
  }

  return (
    <div>
      <div className="section-header">
        <h2 className="section-header__title">Musicians</h2>
      </div>
      <p className="state-message" style={{ padding: '0 0 16px', textAlign: 'left' }}>
        New band members join by creating their own account from the login screen — there's no "add" button here by design.
      </p>

      {loading ? (
        <p className="state-message">Loading musicians…</p>
      ) : error ? (
        <p className="state-message state-message--error">Couldn't load musicians: {error}</p>
      ) : (
        <ul className="simple-list">
          {musicians.map((m) => (
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
                        {m.instruments.length > 0 ? m.instruments.join(', ') : 'No instruments set'}
                      </span>
                    </div>
                    <div className="simple-list__actions">
                      <button className="link-button" onClick={() => setExpandedId(expandedId === m.id ? null : m.id)}>
                        {expandedId === m.id ? 'Hide details' : 'View details'}
                      </button>
                      {isAdmin && m.id !== me?.id && (
                        <>
                          <button className="link-button" onClick={() => setEditingId(m.id)}>Edit</button>
                          <button className="link-button link-button--danger" onClick={() => handleToggleActive(m)}>
                            {m.is_active ? 'Deactivate' : 'Reactivate'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {expandedId === m.id && (
                    <dl className="detail-list">
                      <dt>Phone</dt><dd>{m.phone || '—'}</dd>
                      <dt>Role</dt><dd>{m.role}</dd>
                      <dt>Instruments</dt><dd>{m.instruments.length > 0 ? m.instruments.join(', ') : '—'}</dd>
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

function PlaceholdersSection() {
  const [placeholders, setPlaceholders] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mergeTargets, setMergeTargets] = useState({});

  const load = useCallback(async () => {
    const [{ data: ph }, { data: pr }, { data: insts }, { data: phInsts }] = await Promise.all([
      supabase.from('placeholder_musicians').select('id, name, merged_into').order('name'),
      supabase.from('profiles').select('id, full_name').eq('is_active', true).order('full_name'),
      supabase.from('instruments').select('id, name').order('sort_order'),
      supabase.from('placeholder_musician_instruments').select('placeholder_id, instrument_id, instruments(name)'),
    ]);
  
    // Attach instruments to each placeholder
    const withInsts = (ph || []).map(p => ({
      ...p,
      instruments: (phInsts || []).filter(pi => pi.placeholder_id === p.id).map(pi => ({ id: pi.instrument_id, name: pi.instruments?.name })),
    }));
    setPlaceholders(withInsts);
    setProfiles(pr || []);
    setAllInstruments(insts || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

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

  const active = placeholders.filter((p) => !p.merged_into);
  const merged = placeholders.filter((p) => p.merged_into);

  if (loading) return null;

  return (
    <div style={{ marginTop: 32 }}>
      <div className="section-header">
        <h2 className="section-header__title">Deps &amp; session musicians</h2>
      </div>
      {active.length === 0 ? (
        <p className="state-message">No placeholder musicians yet — add them from a gig's roster.</p>
      ) : (
        <ul className="simple-list">
          {active.map((ph) => (
  <li className="simple-list__item" key={ph.id}>
    <div className="simple-list__row">
      <div>
        <span className="simple-list__title">{ph.name}</span>
        <span className="simple-list__subtitle">
          {ph.instruments?.length > 0
            ? ph.instruments.map(i => i.name).join(', ')
            : 'No instruments set'}
        </span>
        {/* Instrument adder */}
        <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {ph.instruments.map(inst => (
            <span key={inst.id} className="tag">
              {inst.name}
              <button type="button" onClick={async () => {
                await supabase.from('placeholder_musician_instruments')
                  .delete().eq('placeholder_id', ph.id).eq('instrument_id', inst.id);
                load();
              }} aria-label={'Remove ' + inst.name}>×</button>
            </span>
          ))}
          <select
            value=""
            style={{ fontSize: 12, padding: '3px 6px', border: '1px solid var(--line)', borderRadius: 6 }}
            onChange={async (e) => {
              if (!e.target.value) return;
              await supabase.from('placeholder_musician_instruments')
                .insert({ placeholder_id: ph.id, instrument_id: e.target.value });
              load();
            }}
          >
            <option value="">+ Add instrument…</option>
            {allInstruments.filter(i => !ph.instruments.find(pi => pi.id === i.id)).map(i =>
              <option key={i.id} value={i.id}>{i.name}</option>
            )}
          </select>
        </div>
      </div>
      <div className="simple-list__actions" style={{ flexWrap: 'wrap', gap: 6, alignSelf: 'flex-start' }}>
        <select
          value={mergeTargets[ph.id] || ''}
          onChange={(e) => setMergeTargets((prev) => ({ ...prev, [ph.id]: e.target.value }))}
          style={{ fontSize: 13, padding: '4px 6px', border: '1px solid var(--line)', borderRadius: 6 }}
        >
          <option value="">Merge into real account…</option>
          {profiles.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
        </select>
        <button className="link-button" onClick={() => handleMerge(ph)}>Merge</button>
      </div>
    </div>
  </li>
))}
        </ul>
      )}
      {merged.length > 0 && (
        <details style={{ marginTop: 16 }}>
          <summary className="link-button" style={{ cursor: 'pointer' }}>Show {merged.length} merged placeholder{merged.length > 1 ? 's' : ''}</summary>
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
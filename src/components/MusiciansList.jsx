import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import MusicianEditForm from './MusicianEditForm.jsx';
import { useCurrentProfile } from '../hooks/useCurrentProfile.js';

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
    </div>
  );
}
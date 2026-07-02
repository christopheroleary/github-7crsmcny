import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import BandForm from './BandForm.jsx';
import BandMembers from './BandMembers.jsx';
import { useCurrentProfile } from '../context/ProfileContext.jsx';

export default function BandsList() {
  const { isAdmin } = useCurrentProfile();
  const [bands, setBands] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [editingId, setEditingId] = useState(null);

  const loadBands = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('bands').select('*').order('name');
    if (error) setError(error.message);
    else setBands(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadBands();
  }, [loadBands]);

  function handleSaved() {
    setShowAddForm(false);
    setEditingId(null);
    loadBands();
  }

  async function handleDelete(band) {
    const ok = window.confirm(
      'Delete "' + band.name + '"? This also detaches it from any gigs and deletes its setlist library. This cannot be undone.'
    );
    if (!ok) return;
    const { error } = await supabase.from('bands').delete().eq('id', band.id);
    if (error) {
      alert("Couldn't delete: " + error.message);
      return;
    }
    loadBands();
  }

  return (
    <div>
      <div className="section-header">
        <h2 className="section-header__title">Bands</h2>
        <button className="btn btn--primary btn--small" onClick={() => setShowAddForm((v) => !v)}>
          {showAddForm ? 'Close' : '+ Add band'}
        </button>
      </div>

      {showAddForm && <BandForm onSaved={handleSaved} onCancel={() => setShowAddForm(false)} />}

      {loading ? (
        <p className="state-message">Loading bands…</p>
      ) : error ? (
        <p className="state-message state-message--error">Couldn't load bands: {error}</p>
      ) : bands.length === 0 ? (
        <p className="state-message">No bands yet.</p>
      ) : (
        <ul className="simple-list">
          {bands.map((b) => (
            <li className="simple-list__item" key={b.id}>
              {editingId === b.id ? (
                <BandForm band={b} onSaved={handleSaved} onCancel={() => setEditingId(null)} />
              ) : (
                <>
                  <div className="simple-list__row">
                    <div>
                      <span className="simple-list__title">{b.name}</span>
                      {b.notes && <span className="simple-list__subtitle">{b.notes}</span>}
                    </div>
                    <div className="simple-list__actions">
                      <button className="link-button" onClick={() => setExpandedId(expandedId === b.id ? null : b.id)}>
                        {expandedId === b.id ? 'Hide members' : 'View members'}
                      </button>
                      {isAdmin && (
                        <>
                          <button className="link-button" onClick={() => setEditingId(b.id)}>Edit</button>
                          <button className="link-button link-button--danger" onClick={() => handleDelete(b)}>Delete</button>
                        </>
                      )}
                    </div>
                  </div>
                  {expandedId === b.id && <BandMembers bandId={b.id} isAdmin={isAdmin} />}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
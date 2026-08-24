import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import BandForm from './BandForm.jsx';
import BandMembers from './BandMembers.jsx';
import BandLeaders from './BandLeaders.jsx';
import { useCurrentProfile } from '../context/ProfileContext.jsx';
import SearchBox from './SearchBox.jsx';
import { useFuzzySearch } from '../hooks/useFuzzySearch.js';
import { confirmAsync } from '../utils/confirmService.js';
import { notify } from '../utils/toastService.js';

export default function BandsList() {
  const { isAdmin, isBandLeader } = useCurrentProfile();
  const [bands, setBands] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [expandedLeadersId, setExpandedLeadersId] = useState(null);
  // One-shot deep link (e.g. from GigFeeSplit's "set the split percentages"
  // link) -- consumed immediately rather than persisted, so navigating away
  // and back to Bands later doesn't keep reopening the same edit form.
  const [editingId, setEditingId] = useState(() => {
    const id = localStorage.getItem('selected_band_id');
    if (id) localStorage.removeItem('selected_band_id');
    return id || null;
  });

  useEffect(() => {
    function handleBandSelected(e) {
      setEditingId(e.detail?.band_id || null);
    }
    window.addEventListener('band-selected', handleBandSelected);
    return () => window.removeEventListener('band-selected', handleBandSelected);
  }, []);

  const { query, setQuery, results: filteredBands } = useFuzzySearch(bands, ['name', 'notes']);

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
    const ok = await confirmAsync(
      'Delete "' + band.name + '"? This also detaches it from any gigs and deletes its setlist library. This cannot be undone.'
    );
    if (!ok) return;
    const { error } = await supabase.from('bands').delete().eq('id', band.id);
    if (error) {
      notify("Couldn't delete: " + error.message);
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

      {!loading && !error && bands.length > 0 && (
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Search bands…"
          resultCount={filteredBands.length}
          totalCount={bands.length}
        />
      )}

      {loading ? (
        <p className="state-message">Loading bands…</p>
      ) : error ? (
        <p className="state-message state-message--error">Couldn't load bands: {error}</p>
      ) : bands.length === 0 ? (
        <p className="state-message">No bands yet.</p>
      ) : filteredBands.length === 0 ? (
        <p className="state-message">No bands match "{query}".</p>
      ) : (
        <ul className="simple-list">
          {filteredBands.map((b) => (
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
                        <button className="link-button" onClick={() => setExpandedLeadersId(expandedLeadersId === b.id ? null : b.id)}>
                          {expandedLeadersId === b.id ? 'Hide leaders' : 'Leaders'}
                        </button>
                      )}
                      {(isAdmin || isBandLeader) && (
                        <button className="link-button" onClick={() => setEditingId(b.id)}>Edit</button>
                      )}
                      {isAdmin && (
                        <button className="link-button link-button--danger" onClick={() => handleDelete(b)}>Delete</button>
                      )}
                    </div>
                  </div>
                  {expandedId === b.id && <BandMembers bandId={b.id} isAdmin={isAdmin || isBandLeader} />}
                  {isAdmin && expandedLeadersId === b.id && <BandLeaders bandId={b.id} />}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
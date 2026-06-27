import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import VenueForm from './VenueForm.jsx';

export default function VenuesList() {
  const [venues, setVenues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [editingId, setEditingId] = useState(null);

  const loadVenues = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('venues').select('*').order('name');
    if (error) setError(error.message);
    else setVenues(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadVenues();
  }, [loadVenues]);

  function handleSaved() {
    setShowAddForm(false);
    setEditingId(null);
    loadVenues();
  }

  async function handleDelete(venue) {
    const ok = window.confirm(`Delete "${venue.name}"? This can't be undone.`);
    if (!ok) return;
    const { error } = await supabase.from('venues').delete().eq('id', venue.id);
    if (error) {
      alert(`Couldn't delete: ${error.message}`);
      return;
    }
    loadVenues();
  }

  return (
    <div>
      <div className="section-header">
        <h2 className="section-header__title">Venues</h2>
        <button className="btn btn--primary btn--small" onClick={() => setShowAddForm((v) => !v)}>
          {showAddForm ? 'Close' : '+ Add venue'}
        </button>
      </div>

      {showAddForm && <VenueForm onSaved={handleSaved} onCancel={() => setShowAddForm(false)} />}

      {loading ? (
        <p className="state-message">Loading venues…</p>
      ) : error ? (
        <p className="state-message state-message--error">Couldn't load venues: {error}</p>
      ) : venues.length === 0 ? (
        <p className="state-message">No venues yet.</p>
      ) : (
        <ul className="simple-list">
          {venues.map((v) => (
            <li className="simple-list__item" key={v.id}>
              {editingId === v.id ? (
                <VenueForm venue={v} onSaved={handleSaved} onCancel={() => setEditingId(null)} />
              ) : (
                <>
                  <div className="simple-list__row">
                    <div>
                      <span className="simple-list__title">{v.name}</span>
                      {v.address && <span className="simple-list__subtitle">{v.address}</span>}
                    </div>
                    <div className="simple-list__actions">
                      <button className="link-button" onClick={() => setExpandedId(expandedId === v.id ? null : v.id)}>
                        {expandedId === v.id ? 'Hide details' : 'View details'}
                      </button>
                      <button className="link-button" onClick={() => setEditingId(v.id)}>Edit</button>
                      <button className="link-button link-button--danger" onClick={() => handleDelete(v)}>Delete</button>
                    </div>
                  </div>
                  {expandedId === v.id && (
                    <dl className="detail-list">
                      <dt>Contact</dt><dd>{v.contact_name || '—'}</dd>
                      <dt>Phone</dt><dd>{v.phone || '—'}</dd>
                      <dt>Email</dt><dd>{v.email || '—'}</dd>
                      <dt>Load-in notes</dt><dd>{v.load_in_notes || '—'}</dd>
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
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import AddVenueForm from './AddVenueForm.jsx';

export default function VenuesList() {
  const [venues, setVenues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);

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

  function handleCreated() {
    setShowForm(false);
    loadVenues();
  }

  return (
    <div>
      <div className="section-header">
        <h2 className="section-header__title">Venues</h2>
        <button className="btn btn--primary btn--small" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Close' : '+ Add venue'}
        </button>
      </div>

      {showForm && <AddVenueForm onCreated={handleCreated} onCancel={() => setShowForm(false)} />}

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
              <span className="simple-list__title">{v.name}</span>
              {v.address && <span className="simple-list__subtitle">{v.address}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
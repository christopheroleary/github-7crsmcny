import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import AddGigForm from './AddGigForm.jsx';

export default function GigsList() {
  const [gigs, setGigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);

  const loadGigs = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('gigs')
      .select('id, gig_date, start_time, status, fee_amount, venues(name), clients(name)')
      .order('gig_date', { ascending: true });
    if (error) setError(error.message);
    else setGigs(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadGigs();
  }, [loadGigs]);

  function handleCreated() {
    setShowForm(false);
    loadGigs();
  }

  return (
    <div>
      <div className="section-header">
        <h2 className="section-header__title">Gigs</h2>
        <button className="btn btn--primary btn--small" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Close' : '+ Add gig'}
        </button>
      </div>

      {showForm && <AddGigForm onCreated={handleCreated} onCancel={() => setShowForm(false)} />}

      {loading ? (
        <p className="state-message">Loading gigs…</p>
      ) : error ? (
        <p className="state-message state-message--error">Couldn't load gigs: {error}</p>
      ) : gigs.length === 0 ? (
        <p className="state-message">No gigs yet.</p>
      ) : (
        <ul className="gig-list">
          {gigs.map((gig) => {
            const date = new Date(`${gig.gig_date}T00:00:00`);
            const day = date.toLocaleDateString('en-GB', { day: '2-digit' });
            const month = date.toLocaleDateString('en-GB', { month: 'short' }).toUpperCase();
            return (
              <li className="gig-card" key={gig.id}>
                <div className="gig-card__main">
                  <span className={`status-tag status-tag--${gig.status}`}>{gig.status}</span>
                  <h2 className="gig-card__venue">{gig.venues?.name ?? 'No venue set'}</h2>
                  <p className="gig-card__client">{gig.clients?.name ?? 'No client set'}</p>
                  {gig.fee_amount != null && <p className="gig-card__fee">£{Number(gig.fee_amount).toFixed(2)}</p>}
                </div>
                <div className="gig-card__stub">
                  <span className="gig-card__day">{day}</span>
                  <span className="gig-card__month">{month}</span>
                  {gig.start_time && <span className="gig-card__time">{gig.start_time.slice(0, 5)}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

export default function GigsList() {
  const [gigs, setGigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;

    async function loadGigs() {
      const { data, error } = await supabase
        .from('gigs')
        .select('id, gig_date, start_time, status, fee_amount, venues(name), clients(name)')
        .order('gig_date', { ascending: true });

      if (!active) return;
      if (error) setError(error.message);
      else setGigs(data);
      setLoading(false);
    }

    loadGigs();
    return () => {
      active = false;
    };
  }, []);

  if (loading) return <p className="state-message">Loading gigs…</p>;
  if (error) return <p className="state-message state-message--error">Couldn't load gigs: {error}</p>;
  if (gigs.length === 0) {
    return <p className="state-message">No gigs yet. Add one in Supabase's Table Editor to see it here.</p>;
  }

  return (
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
              {gig.fee_amount != null && (
                <p className="gig-card__fee">£{Number(gig.fee_amount).toFixed(2)}</p>
              )}
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
  );
}

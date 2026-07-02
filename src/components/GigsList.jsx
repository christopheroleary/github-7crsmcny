import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useCurrentProfile } from '../context/ProfileContext.jsx';
import GigForm from './GigForm.jsx';
import GigDetail from './GigDetail.jsx';
import GigDetailBandMember from './GigDetailBandMember.jsx';

export default function GigsList() {
  const { profile, isAdmin } = useCurrentProfile();
  const [gigs, setGigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedGigId, setSelectedGigId] = useState(null);

  const loadGigs = useCallback(async () => {
    setLoading(true);
    const selectFields = isAdmin
      ? 'id, gig_date, start_time, status, fee_amount, venues(name), clients(name), bands(name)'
      : 'id, gig_date, start_time, status, venues(name), bands(name)';

    const { data, error } = await supabase
      .from('gigs')
      .select(selectFields)
      .order('gig_date', { ascending: true });

    if (error) setError(error.message);
    else setGigs(data || []);
    setLoading(false);
  }, [isAdmin]);

  useEffect(() => {
    loadGigs();
  }, [loadGigs]);

  function handleCreated() {
    setShowAddForm(false);
    loadGigs();
  }

  async function handleDelete(gig, e) {
    e.stopPropagation();
    const ok = window.confirm(
      'Delete this gig? This also permanently deletes its lineup, setlist, and invoice records. This cannot be undone.'
    );
    if (!ok) return;
    const { error } = await supabase.from('gigs').delete().eq('id', gig.id);
    if (error) {
      alert("Couldn't delete: " + error.message);
      return;
    }
    loadGigs();
  }

  if (selectedGigId) {
    if (isAdmin) {
      return (
        <GigDetail
          gigId={selectedGigId}
          onBack={() => setSelectedGigId(null)}
          onDeleted={() => {
            setSelectedGigId(null);
            loadGigs();
          }}
        />
      );
    }
    return (
      <GigDetailBandMember
        gigId={selectedGigId}
        myProfileId={profile?.id}
        onBack={() => setSelectedGigId(null)}
      />
    );
  }

  return (
    <div>
      <div className="section-header">
        <h2 className="section-header__title">{isAdmin ? 'Gigs' : 'My gigs'}</h2>
        {isAdmin && (
          <button
            className="btn btn--primary btn--small"
            onClick={() => setShowAddForm((v) => !v)}
          >
            {showAddForm ? 'Close' : '+ Add gig'}
          </button>
        )}
      </div>

      {isAdmin && showAddForm && (
        <GigForm onSaved={handleCreated} onCancel={() => setShowAddForm(false)} />
      )}

      {loading ? (
        <p className="state-message">Loading gigs…</p>
      ) : error ? (
        <p className="state-message state-message--error">Couldn't load gigs: {error}</p>
      ) : gigs.length === 0 ? (
        <p className="state-message">
          {isAdmin ? 'No gigs yet.' : "You haven't been added to any gigs yet."}
        </p>
      ) : (
        <ul className="gig-list">
          {gigs.map((gig) => {
            const date = new Date(`${gig.gig_date}T00:00:00`);
            const day = date.toLocaleDateString('en-GB', { day: '2-digit' });
            const month = date.toLocaleDateString('en-GB', { month: 'short' }).toUpperCase();
            return (
              <li
                className="gig-card"
                key={gig.id}
                onClick={() => setSelectedGigId(gig.id)}
                style={{ cursor: 'pointer' }}
              >
                <div className="gig-card__main">
                  <span className={`status-tag status-tag--${gig.status}`}>{gig.status}</span>
                  <h2 className="gig-card__venue">{gig.venues?.name ?? 'No venue set'}</h2>
                  {gig.bands?.name && <p className="gig-card__client">{gig.bands.name}</p>}
                  {isAdmin && gig.clients?.name && (
                    <p className="gig-card__client">{gig.clients.name}</p>
                  )}
                  {isAdmin && gig.fee_amount != null && (
                    <p className="gig-card__fee">£{Number(gig.fee_amount).toFixed(2)}</p>
                  )}
                  {isAdmin && (
                    <button
                      className="link-button link-button--danger"
                      onClick={(e) => handleDelete(gig, e)}
                    >
                      Delete
                    </button>
                  )}
                </div>
                <div className="gig-card__stub">
                  <span className="gig-card__day">{day}</span>
                  <span className="gig-card__month">{month}</span>
                  {gig.start_time && (
                    <span className="gig-card__time">{gig.start_time.slice(0, 5)}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
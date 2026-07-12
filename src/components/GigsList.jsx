import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { useCurrentProfile } from '../context/ProfileContext.jsx';
import { useOfflineGigList } from '../hooks/useOfflineGigList.js';
import GigForm from './GigForm.jsx';
import GigDetail from './GigDetail.jsx';
import GigDetailBandMember from './GigDetailBandMember.jsx';
import { formatShortDate } from '../utils/formatDate.js';
import CalendarFeed from './CalendarFeed.jsx';

const today = () => new Date().toISOString().slice(0, 10);

export default function GigsList() {
  const { profile: me, isAdmin } = useCurrentProfile();

  const [selectedGigId, setSelectedGigId] = useState(
    () => sessionStorage.getItem('selected_gig_id') || null
  );
  function selectGig(id) {
    if (id) sessionStorage.setItem('selected_gig_id', id);
    else sessionStorage.removeItem('selected_gig_id');
    setSelectedGigId(id);
  }

  const [showHistoric, setShowHistoric] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  // ── Offline-aware gig list (replaces the old loadGigs / useState(gigs)) ──────
  const {
    gigs,
    isOffline,
    syncing,
    syncedAt,
    cachedGigIds,
    error,
    refresh: loadGigs,
  } = useOfflineGigList({
    isAdmin,
    profileId: me?.id,
    showHistoric,
  });

  // ── Keep sessionStorage navigation working (notification clicks etc.) ────────
  useEffect(() => {
    function handleStorage() {
      const id = sessionStorage.getItem('selected_gig_id');
      setSelectedGigId(id || null);
    }
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    function handleGigSelected(e) {
      setSelectedGigId(e.detail.gig_id || null);
    }
    window.addEventListener('gig-selected', handleGigSelected);
    return () => window.removeEventListener('gig-selected', handleGigSelected);
  }, []);

  // ── Delete (admin only) ──────────────────────────────────────────────────────
  async function handleDelete(gig, e) {
    e.stopPropagation();
    const ok = window.confirm(
      'Delete this gig? This also permanently deletes its lineup, setlist, and invoice records.'
    );
    if (!ok) return;
    const { error } = await supabase.from('gigs').delete().eq('id', gig.id);
    if (error) { alert("Couldn't delete: " + error.message); return; }
    loadGigs();
  }

  // ── Detail view ──────────────────────────────────────────────────────────────
  if (selectedGigId) {
    if (isAdmin) {
      return (
        <GigDetail
          gigId={selectedGigId}
          onBack={() => selectGig(null)}
          onDeleted={() => { selectGig(null); loadGigs(); }}
        />
      );
    }
    return (
      <GigDetailBandMember
        gigId={selectedGigId}
        myProfileId={me?.id}
        onBack={() => selectGig(null)}
      />
    );
  }

  // ── List view ────────────────────────────────────────────────────────────────
  return (
    <div>
      <div className="section-header">
        <h2 className="section-header__title">{isAdmin ? 'Gigs' : 'My gigs'}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn--ghost btn--small"
            onClick={() => setShowHistoric((v) => !v)}
          >
            {showHistoric ? 'Hide historic' : 'Show historic'}
          </button>
          {isAdmin && (
            <button
              className="btn btn--primary btn--small"
              onClick={() => setShowAddForm((v) => !v)}
            >
              {showAddForm ? 'Close' : '+ Add gig'}
            </button>
          )}
        </div>
      </div>

      {/* ── Offline / sync status bar ────────────────────────────────────────── */}
      {isOffline && (
        <div className="sync-bar sync-bar--offline">
          <div className="sync-bar__left">
            <span className="sync-bar__dot sync-bar__dot--offline" />
            <span>
              <strong>Offline</strong>
              {syncedAt
                ? ' — list cached ' + formatSyncTime(syncedAt)
                : ' — no cached list'}
            </span>
          </div>
        </div>
      )}
      {!isOffline && syncing && (
        <div className="sync-bar sync-bar--online">
          <div className="sync-bar__left">
            <span className="sync-bar__dot sync-bar__dot--online" />
            <span>Syncing gigs…</span>
          </div>
        </div>
      )}

      {!isAdmin && me && <CalendarFeed profileId={me.id} />}

      {isAdmin && showAddForm && (
        <GigForm
          onSaved={() => { setShowAddForm(false); loadGigs(); }}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {/* ── States ───────────────────────────────────────────────────────────── */}
      {syncing && gigs.length === 0 ? (
        <p className="state-message">Loading gigs…</p>
      ) : error && gigs.length === 0 ? (
        <p className="state-message state-message--error">
          Couldn't load gigs: {error}
        </p>
      ) : gigs.length === 0 ? (
        <p className="state-message">
          {showHistoric
            ? 'No gigs found.'
            : isAdmin
            ? 'No upcoming gigs.'
            : "No upcoming gigs — you haven't been added to any yet."}
        </p>
      ) : (
        <>
          <ul className="gig-list">
            {gigs.map((gig) => {
              const isPast = gig.gig_date < today();
              const isAvailableOffline = cachedGigIds.includes(gig.id);
              // Dim and block tap only when offline AND not cached
              const isDisabled = isOffline && !isAvailableOffline;

              return (
                <li
                  key={gig.id}
                  className={[
                    'gig-card',
                    isPast ? 'gig-card--historic' : '',
                    isDisabled ? 'gig-card--offline-unavailable' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={isDisabled ? undefined : () => selectGig(gig.id)}
                  style={{ cursor: isDisabled ? 'default' : 'pointer' }}
                >
                  <div className="gig-card__stub">
                    <span className="gig-card__date">{formatShortDate(gig.gig_date)}</span>
                    {gig.start_time && (
                      <span className="gig-card__time">{gig.start_time.slice(0, 5)}</span>
                    )}
                    {/* Offline availability dot — only shown when offline */}
                    {isOffline && (
                      <span
                        className={
                          'offline-dot ' +
                          (isAvailableOffline ? 'offline-dot--cached' : 'offline-dot--missing')
                        }
                        title={isAvailableOffline ? 'Available offline' : 'Not available offline'}
                      />
                    )}
                  </div>
                  <div className="gig-card__main">
                    <span className={`status-tag status-tag--${gig.status}`}>{gig.status}</span>
                    <h2 className="gig-card__venue">{gig.venues?.name ?? 'No venue set'}</h2>
                    {gig.bands?.name && (
                      <p className="gig-card__client">{gig.bands.name}</p>
                    )}
                    {isAdmin && gig.clients?.name && (
                      <p className="gig-card__client">{gig.clients.name}</p>
                    )}
                    {isAdmin && gig.fee_amount != null && (
                      <p className="gig-card__fee">
                        £{Math.round(Number(gig.fee_amount)).toLocaleString('en-GB')}
                      </p>
                    )}
                    {isAdmin && !isDisabled && (
                      <button
                        className="link-button link-button--danger"
                        onClick={(e) => handleDelete(gig, e)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {isOffline && (
            <p className="state-message" style={{ fontSize: '0.8rem', marginTop: 8 }}>
              Dimmed gigs aren't cached for offline use. Connect to the internet to sync them.
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatSyncTime(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const diffMins = Math.floor((Date.now() - d) / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return diffMins + 'm ago';
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return diffHours + 'h ago';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
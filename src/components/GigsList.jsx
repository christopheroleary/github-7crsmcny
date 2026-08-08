import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { useCurrentProfile } from '../context/ProfileContext.jsx';
import { useOfflineGigList } from '../hooks/useOfflineGigList.js';
import GigForm from './GigForm.jsx';
import GigDetail from './GigDetail.jsx';
import GigDetailBandMember from './GigDetailBandMember.jsx';
import { formatShortDate, formatTicketStub, todayStr } from '../utils/formatDate.js';
import CalendarFeed from './CalendarFeed.jsx';
import SearchBox from './SearchBox.jsx';
import { useFuzzySearch } from '../hooks/useFuzzySearch.js';
import { confirmAsync } from '../utils/confirmService.js';
import { notify } from '../utils/toastService.js';

const today = todayStr;

// ── Claim status display maps (mirrors MusicianClaim.jsx) ─────────────────────
const CLAIM_CARD_LABELS = {
  pending:  'Claim pending',
  approved: 'Claim approved',
  paid:     'Claim paid',
  rejected: 'Claim rejected',
};
const CLAIM_CARD_COLORS = {
  pending:  'inquiry',
  approved: 'confirmed',
  paid:     'completed',
  rejected: 'cancelled',
};

// ── Invoice status display maps ───────────────────────────────────────────────
const INVOICE_CARD_LABELS = {
  draft:   'Invoice draft',
  sent:    'Invoice sent',
  paid:    'Invoice paid',
  overdue: 'Invoice overdue',
};
const INVOICE_CARD_COLORS = {
  draft:   'inquiry',
  sent:    'confirmed',
  paid:    'completed',
  overdue: 'cancelled',
};

export default function GigsList() {
  const { profile: me, isAdmin: isAdminRole, isBandLeader } = useCurrentProfile();
  // Band leaders get the same full-management gig UI as admin, scoped to their
  // own bands by RLS — see the plan's "full management" decision.
  const isAdmin = isAdminRole || isBandLeader;

  // localStorage so this survives a full PWA restart, not just a re-render —
  // see the matching note in App.jsx.
  const [selectedGigId, setSelectedGigId] = useState(
    () => localStorage.getItem('selected_gig_id') || null
  );
  // Which section of the gig page to scroll to on open (e.g. from a
  // notification click) — a one-shot value, not persisted, cleared once
  // GigDetail/GigDetailBandMember has performed the scroll.
  const [selectedSection, setSelectedSection] = useState(null);
  function selectGig(id) {
    if (id) localStorage.setItem('selected_gig_id', id);
    else localStorage.removeItem('selected_gig_id');
    setSelectedGigId(id);
    setSelectedSection(null);
  }

  const [showHistoric, setShowHistoric] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showNeedsInvoicing, setShowNeedsInvoicing] = useState(false);   // admin
  const [showUnclaimedGigs, setShowUnclaimedGigs] = useState(false);     // band member
  const [showPendingClaims, setShowPendingClaims] = useState(false);     // admin
  const [showIncompleteRoster, setShowIncompleteRoster] = useState(false); // admin

  // ── Offline-aware gig list (replaces the old loadGigs / useState(gigs)) ──────
  const {
    gigs: rawGigs,
    isOffline,
    syncing,
    syncedAt,
    cachedGigIds,
    error,
    refresh: loadGigs,
  } = useOfflineGigList({
    isAdmin,
    profileId: me?.id,
    // these filters target past gigs, so force historic on when any is active.
    // showIncompleteRoster is deliberately excluded — it's an upcoming-gigs concern.
    showHistoric: showHistoric || showNeedsInvoicing || showUnclaimedGigs || showPendingClaims,
  });

  // ── Client-side filters ───────────────────────────────────────────────────────
  // Admin: past gigs whose band invoice hasn't been sent or paid.
  //   Assumes gig objects expose `invoice_status` (joined from the invoices table).
  // Band member: past gigs where the user's musician claim isn't approved or paid.
  //   claim_status is merged onto each gig by fetchGigList in useOfflineGigList.
  //   null = no claim submitted yet, 'pending'/'rejected' = not yet settled.
  const gigs = (() => {
    if (showNeedsInvoicing) {
      return rawGigs.filter(
        (g) => g.gig_date < today() && !['sent', 'paid'].includes(g.invoice_status)
      );
    }
    if (showUnclaimedGigs) {
      return rawGigs.filter(
        (g) => g.gig_date < today() && !['approved', 'paid'].includes(g.claim_status)
      );
    }
    if (showPendingClaims) {
      return rawGigs.filter((g) => g.has_pending_claim);
    }
    if (showIncompleteRoster) {
      return rawGigs.filter((g) => g.status !== 'cancelled' && g.roster_incomplete);
    }
    return rawGigs;
  })();

  const { query, setQuery, results: searchedGigs } = useFuzzySearch(gigs, [
    'venues.name',
    'bands.name',
    'clients.name',
    'status',
    'notes',
    { name: 'dateLabel', getFn: (gig) => formatShortDate(gig.gig_date) },
  ]);

  // ── Keep cross-tab navigation working (notification clicks etc.) ─────────────
  useEffect(() => {
    function handleStorage() {
      const id = localStorage.getItem('selected_gig_id');
      setSelectedGigId(id || null);
    }
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    function handleGigSelected(e) {
      setSelectedGigId(e.detail.gig_id || null);
      setSelectedSection(e.detail.section || null);
    }
    window.addEventListener('gig-selected', handleGigSelected);
    return () => window.removeEventListener('gig-selected', handleGigSelected);
  }, []);

  // ── Delete (admin only) ──────────────────────────────────────────────────────
  async function handleDelete(gig, e) {
    e.stopPropagation();
    const ok = await confirmAsync(
      'Delete this gig? This also permanently deletes its lineup, setlist, and invoice records.'
    );
    if (!ok) return;
    const { error } = await supabase.from('gigs').delete().eq('id', gig.id);
    if (error) { notify("Couldn't delete: " + error.message); return; }
    loadGigs();
  }

  // ── Detail view ──────────────────────────────────────────────────────────────
  if (selectedGigId) {
    if (isAdmin) {
      return (
        <GigDetail
          gigId={selectedGigId}
          onBack={() => { selectGig(null); loadGigs(); }}
          onDeleted={() => { selectGig(null); loadGigs(); }}
          scrollToSection={selectedSection}
          onScrolled={() => setSelectedSection(null)}
        />
      );
    }
    return (
      <GigDetailBandMember
        gigId={selectedGigId}
        myProfileId={me?.id}
        onBack={() => { selectGig(null); loadGigs(); }}
        scrollToSection={selectedSection}
        onScrolled={() => setSelectedSection(null)}
      />
    );
  }

  // ── List view ────────────────────────────────────────────────────────────────
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 6, marginBottom: 16 }}>
        <button
          className="btn btn--ghost btn--small"
          onClick={() => setShowHistoric((v) => !v)}
        >
          {showHistoric ? 'Hide historic' : 'Show historic'}
        </button>
        {isAdmin && (
          <button
            className={`btn btn--small ${showNeedsInvoicing ? 'btn--primary' : 'btn--ghost'}`}
            onClick={() => {
              setShowNeedsInvoicing((v) => !v);
              setShowPendingClaims(false);
              setShowIncompleteRoster(false);
            }}
          >
            {showNeedsInvoicing ? 'Needs invoicing ✕' : 'Needs invoicing'}
          </button>
        )}
        {isAdmin && (
          <button
            className={`btn btn--small ${showPendingClaims ? 'btn--primary' : 'btn--ghost'}`}
            onClick={() => {
              setShowPendingClaims((v) => !v);
              setShowNeedsInvoicing(false);
              setShowIncompleteRoster(false);
            }}
          >
            {showPendingClaims ? 'Pending claims ✕' : 'Pending claims'}
          </button>
        )}
        {isAdmin && (
          <button
            className={`btn btn--small ${showIncompleteRoster ? 'btn--primary' : 'btn--ghost'}`}
            onClick={() => {
              setShowIncompleteRoster((v) => !v);
              setShowNeedsInvoicing(false);
              setShowPendingClaims(false);
            }}
          >
            {showIncompleteRoster ? 'Roster incomplete ✕' : 'Roster incomplete'}
          </button>
        )}
        {!isAdmin && (
          <button
            className={`btn btn--small ${showUnclaimedGigs ? 'btn--primary' : 'btn--ghost'}`}
            onClick={() => setShowUnclaimedGigs((v) => !v)}
          >
            {showUnclaimedGigs ? 'Unpaid claims ✕' : 'Unpaid claims'}
          </button>
        )}
      </div>

      {/* ── Active filter hint ───────────────────────────────────────────────── */}
      {(showNeedsInvoicing || showUnclaimedGigs || showPendingClaims || showIncompleteRoster) && (
        <p className="filter-hint">
          {showNeedsInvoicing && 'Showing past gigs with unsettled invoices.'}
          {showUnclaimedGigs && 'Showing past gigs with outstanding or missing claims.'}
          {showPendingClaims && 'Showing gigs with a musician claim awaiting your review.'}
          {showIncompleteRoster && "Showing gigs whose roster isn't fully booked yet."}
        </p>
      )}

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

      {gigs.length > 0 && (
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Search gigs by venue, band, client, date…"
          resultCount={searchedGigs.length}
          totalCount={gigs.length}
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
          {showNeedsInvoicing
            ? 'No past gigs with outstanding invoices.'
            : showUnclaimedGigs
            ? 'No past gigs with unpaid claims — you\'re all up to date.'
            : showPendingClaims
            ? 'No claims waiting for review — you\'re all up to date.'
            : showIncompleteRoster
            ? 'Every roster is fully booked.'
            : showHistoric
            ? 'No gigs found.'
            : isAdmin
            ? 'No upcoming gigs.'
            : "No upcoming gigs — you haven't been added to any yet."}
        </p>
      ) : searchedGigs.length === 0 ? (
        <p className="state-message">No gigs match "{query}".</p>
      ) : (
        <>
          <ul className="gig-list">
            {searchedGigs.map((gig) => {
              const isPast = gig.gig_date < today();
              const isAvailableOffline = cachedGigIds.includes(gig.id);
              // Dim and block tap only when offline AND not cached
              const isDisabled = isOffline && !isAvailableOffline;
              const stub = formatTicketStub(gig.gig_date);
              // Musician hasn't confirmed their availability for this booking yet.
              const needsConfirmation = !isAdmin && !isPast && gig.status !== 'cancelled' && !gig.my_confirmed;

              return (
                <li
                  key={gig.id}
                  className={[
                    'gig-card',
                    isPast ? 'gig-card--historic' : '',
                    isDisabled ? 'gig-card--offline-unavailable' : '',
                    needsConfirmation ? 'gig-card--needs-confirmation' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={isDisabled ? undefined : () => selectGig(gig.id)}
                  style={{ cursor: isDisabled ? 'default' : 'pointer' }}
                >
                  <div className="gig-card__stub">
                    <span className="gig-card__weekday">{stub.weekday}</span>
                    <span className="gig-card__day">{stub.day}</span>
                    <span className="gig-card__month">{stub.month}</span>
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
                    {/* Invoice status — admin only. Shown on upcoming gigs too, since
                        unlike musician claims, band invoices can be sent before the gig. */}
                    {isAdmin && (
                      <span
                        className={`status-tag status-tag--${
                          INVOICE_CARD_COLORS[gig.invoice_status] ?? 'muted'
                        }`}
                      >
                        {INVOICE_CARD_LABELS[gig.invoice_status] ?? 'No invoice'}
                      </span>
                    )}
                    {/* Claim status — band members only, past gigs only */}
                    {!isAdmin && isPast && (
                      <span
                        className={`status-tag status-tag--${
                          CLAIM_CARD_COLORS[gig.claim_status] ?? 'muted'
                        }`}
                      >
                        {CLAIM_CARD_LABELS[gig.claim_status] ?? 'No claim'}
                      </span>
                    )}
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
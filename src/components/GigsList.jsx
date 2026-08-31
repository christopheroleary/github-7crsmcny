import { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { useCurrentProfile } from '../context/ProfileContext.jsx';
import { useOfflineGigList } from '../hooks/useOfflineGigList.js';
import GigForm from './GigForm.jsx';
import GigDetail from './GigDetail.jsx';
import GigDetailBandMember from './GigDetailBandMember.jsx';
import { formatShortDate, formatTicketStub, todayStr } from '../utils/formatDate.js';
import GigCalendar from './GigCalendar.jsx';
import BandLeaderGigGrid from './BandLeaderGigGrid.jsx';
import SearchBox from './SearchBox.jsx';
import { useFuzzySearch } from '../hooks/useFuzzySearch.js';

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
  const { profile: me, isAdmin: isAdminRole, isBandLeader, ledBandIds } = useCurrentProfile();
  // Band leaders get the same full-management gig UI as admin, scoped to their
  // own bands by RLS — see the plan's "full management" decision. This drives
  // list-level identity choices (which filters/columns, "Gigs" vs "My gigs",
  // what gets fetched) -- genuinely org-wide questions, not gig-specific ones.
  const isAdmin = isAdminRole || isBandLeader;
  // But which SPECIFIC gigs a leader can actually manage is per-band, not
  // blanket -- a leader of Band A merely performing at a Band B gig has zero
  // write access there (see gigs_update_admin/etc RLS), so anything that
  // decides "can THIS gig be managed" needs this instead of the blanket flag
  // above. Used for the detail-view choice and the confirm-prompt below.
  function canManageGig(gig) {
    // No gig row yet (e.g. a historic gig not pulled into rawGigs while
    // showHistoric is off) -- fall back to the identity-level flag rather
    // than wrongly assuming "no". GigDetail.jsx does its own authoritative
    // fetch and self-guards regardless, so a wrong "yes" here self-corrects;
    // this only avoids a wrong "no" while data is still loading.
    if (!gig) return isAdmin;
    return isAdminRole || !!(gig.band_id && ledBandIds.includes(gig.band_id));
  }

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

  // Persisted like selected_gig_id below — the chosen view survives a
  // reload/PWA restart instead of always resetting to List.
  const [viewMode, setViewMode] = useState(
    () => localStorage.getItem('gig_manager_view_mode') || 'list'
  );
  function changeViewMode(mode) {
    localStorage.setItem('gig_manager_view_mode', mode);
    setViewMode(mode);
  }

  const [showHistoric, setShowHistoric] = useState(false);
  // Ascending date order means turning Show historic on tacks a potentially
  // long run of past gigs onto the FRONT of the list -- without this, the
  // user lands on the oldest gig in their history instead of where they
  // actually want to start: today, working backwards or forwards from there.
  // todayRowRef marks that boundary row (set inside the list render below);
  // scrolledForHistoricRef guards the scroll to once per "on" toggle, not
  // every re-render while it stays on (a later search/filter change, a
  // background resync, etc.), and resets when historic is switched off so
  // turning it on again scrolls again.
  const todayRowRef = useRef(null);
  const scrolledForHistoricRef = useRef(false);
  // Grid view's own table header is sticky too (see .gig-grid thead th),
  // stacking directly below this sticky title/toggle block rather than
  // overlapping it -- which needs to know this block's actual height. A
  // hardcoded px value would drift wrong the moment its content wraps
  // differently (narrower screen, more tabs added later, etc. -- this
  // was tried and confirmed broken at a narrower width before switching
  // to measuring it for real). ResizeObserver keeps a CSS var in sync
  // with whatever the real height actually is, on any screen, always.
  const stickyHeaderRef = useRef(null);
  useEffect(() => {
    const el = stickyHeaderRef.current;
    if (!el) return;
    const setVar = () => {
      document.documentElement.style.setProperty('--gigs-sticky-header-height', el.getBoundingClientRect().height + 'px');
    };
    setVar();
    const observer = new ResizeObserver(setVar);
    observer.observe(el);
    return () => observer.disconnect();
  }, [viewMode]);
  const [showAddForm, setShowAddForm] = useState(false);
  // Set when "add a gig" is triggered from a specific calendar date (an
  // empty day, or the "Add gig" option in a day's popover) rather than the
  // page-level "+ Add gig" button -- prefills GigForm's date field via the
  // same _isConvert prefill shape EnquiriesList already uses to hand it a
  // partial gig without being mistaken for editing a real one.
  const [addGigDate, setAddGigDate] = useState(null);
  const addFormRef = useRef(null);
  function startAddGig(iso) {
    setAddGigDate(iso);
    setShowAddForm(true);
  }
  function closeAddForm() {
    setShowAddForm(false);
    setAddGigDate(null);
  }
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
    // Calendar mode also forces it on — paging back to a past month needs the
    // full history, and the hook can't be called conditionally to fetch a
    // narrower range only in list mode.
    showHistoric: showHistoric || showNeedsInvoicing || showUnclaimedGigs || showPendingClaims || viewMode === 'calendar',
  });

  // BandLeaderGigGrid (the Grid view) keeps its own independent gigs fetch,
  // entirely separate from rawGigs above -- List and Calendar already share
  // rawGigs directly, but Grid only refetches on its own mount, so a gig
  // added/edited elsewhere doesn't show there until the view is switched
  // away and back. Bumping this counter alongside every existing loadGigs()
  // call gives Grid's own fetch effect a reason to re-run too.
  const [gigsVersion, setGigsVersion] = useState(0);
  function bumpGigs() {
    setGigsVersion((v) => v + 1);
    loadGigs();
  }

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

  // First gig at or after today in the (ascending-sorted) currently-rendered
  // list -- the row todayRowRef marks below, and what the scroll-to-today
  // effect targets. Only meaningful for the plain historic list, not one of
  // the other filtered views (needs invoicing/unpaid claims/pending claims/
  // incomplete roster) -- those are already narrowed to a specific subset
  // with no "today" divider to scroll to.
  const otherFilterActive =
    showNeedsInvoicing || showUnclaimedGigs || showPendingClaims || showIncompleteRoster;
  const firstUpcomingGig = otherFilterActive ? null : searchedGigs.find((g) => g.gig_date >= today());
  // Whether the historic gigs this scroll targets have actually arrived yet
  // -- checked against `gigs` (pre-search-filter), not `searchedGigs`, so a
  // search query that happens to hide every historic row doesn't itself
  // read as "still loading". `syncing` looked like the obvious gate here,
  // but there's a real render race: the very first render right after the
  // toggle click still shows syncing's PREVIOUS value (false, from before
  // the click) because useOfflineGigList's own effect -- the one that
  // actually flips it true and starts the fetch -- hasn't run yet at that
  // point. Checking for a genuine historic row directly sidesteps that
  // timing entirely.
  const hasHistoricLoaded = gigs.some((g) => g.gig_date < today());

  useEffect(() => {
    if (!showHistoric || otherFilterActive) {
      // Reset so switching historic off and back on scrolls again, rather
      // than only ever firing once per mount.
      scrolledForHistoricRef.current = false;
      return;
    }
    if (scrolledForHistoricRef.current || !todayRowRef.current || !hasHistoricLoaded) return;
    // 'center' rather than 'start' -- leaves a few recent-past gigs visible
    // just above today's row, so scrolling up from here immediately shows
    // more of them instead of landing with today pinned to the very top edge.
    todayRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    scrolledForHistoricRef.current = true;
  }, [showHistoric, otherFilterActive, hasHistoricLoaded, searchedGigs]);

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

  // The form renders above the calendar, off the bottom of the viewport
  // when it's opened by clicking a date -- scroll it into view so it
  // doesn't look like the click did nothing.
  useEffect(() => {
    if (showAddForm && addGigDate) {
      addFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [showAddForm, addGigDate]);

  // ── Detail view ──────────────────────────────────────────────────────────────
  if (selectedGigId) {
    // Looked up from the unfiltered rawGigs, not the client-filtered `gigs`
    // (showNeedsInvoicing/showUnclaimedGigs/etc. could otherwise hide the
    // very row being viewed, leaving nothing here to check band_id against).
    const selectedGig = rawGigs.find((g) => g.id === selectedGigId);
    if (canManageGig(selectedGig)) {
      return (
        <GigDetail
          gigId={selectedGigId}
          onBack={() => { selectGig(null); bumpGigs(); }}
          onDeleted={() => { selectGig(null); bumpGigs(); }}
          scrollToSection={selectedSection}
          onScrolled={() => setSelectedSection(null)}
        />
      );
    }
    return (
      <GigDetailBandMember
        gigId={selectedGigId}
        myProfileId={me?.id}
        onBack={() => { selectGig(null); bumpGigs(); }}
        scrollToSection={selectedSection}
        onScrolled={() => setSelectedSection(null)}
      />
    );
  }

  // ── List view ────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Sticky, not a second scrollable box -- title/toggle/filters/search
          pin to the top of the (single, natural) page scroll as you scroll
          past them, rather than living inside their own overflow:auto
          container. A nested scrollbox risks exactly the kind of touch/
          scroll conflicts this app has already hit and fixed once before
          (see the pull-to-refresh removal); sticky uses the browser's own
          single scroll container instead, and this codebase already
          proves it works fine here (BandLeaderGigGrid's table header uses
          the same technique). Scoped to this page only -- the global
          header/tab-nav above it are untouched. */}
      <div className="gigs-sticky-header" ref={stickyHeaderRef}>
      <div className="section-header">
        <h2 className="section-header__title">{isAdmin ? 'Gigs' : 'My gigs'}</h2>
        {isAdmin && (
          <button
            className="btn btn--primary btn--small"
            onClick={() => (showAddForm ? closeAddForm() : startAddGig(null))}
          >
            {showAddForm ? 'Close' : '+ Add gig'}
          </button>
        )}
      </div>

      <div className="view-toggle" style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        <button
          className={`btn btn--small ${viewMode === 'list' ? 'btn--primary' : 'btn--ghost'}`}
          style={{ width: 'auto', flexShrink: 0, whiteSpace: 'nowrap' }}
          onClick={() => changeViewMode('list')}
        >
          List
        </button>
        <button
          className={`btn btn--small ${viewMode === 'calendar' ? 'btn--primary' : 'btn--ghost'}`}
          style={{ width: 'auto', flexShrink: 0, whiteSpace: 'nowrap' }}
          onClick={() => changeViewMode('calendar')}
        >
          Calendar
        </button>
        <button
          className={`btn btn--small ${viewMode === 'grid' ? 'btn--primary' : 'btn--ghost'}`}
          style={{ width: 'auto', flexShrink: 0, whiteSpace: 'nowrap' }}
          onClick={() => changeViewMode('grid')}
        >
          Grid
        </button>
      </div>

      {viewMode === 'list' && (
        <>
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

          {/* ── Active filter hint ───────────────────────────────────────────── */}
          {(showNeedsInvoicing || showUnclaimedGigs || showPendingClaims || showIncompleteRoster) && (
            <p className="filter-hint">
              {showNeedsInvoicing && 'Showing past gigs with unsettled invoices.'}
              {showUnclaimedGigs && 'Showing past gigs with outstanding or missing claims.'}
              {showPendingClaims && 'Showing gigs with a musician claim awaiting your review.'}
              {showIncompleteRoster && "Showing gigs whose roster isn't fully booked yet."}
            </p>
          )}
        </>
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

      {isAdmin && showAddForm && (
        <div ref={addFormRef}>
          <GigForm
            gig={addGigDate ? { _isConvert: true, gig_date: addGigDate } : undefined}
            onSaved={() => { closeAddForm(); bumpGigs(); }}
            onCancel={closeAddForm}
          />
        </div>
      )}

      {viewMode === 'list' && gigs.length > 0 && (
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Search gigs by venue, band, client, date…"
          resultCount={searchedGigs.length}
          totalCount={gigs.length}
        />
      )}
      </div>

      {viewMode === 'calendar' && (
        <GigCalendar
          gigs={rawGigs}
          isAdmin={isAdmin}
          isOffline={isOffline}
          cachedGigIds={cachedGigIds}
          onSelectGig={selectGig}
          onAddGig={startAddGig}
        />
      )}

      {viewMode === 'grid' && (
        <BandLeaderGigGrid onSelectGig={selectGig} gigsVersion={gigsVersion} />
      )}

      {viewMode === 'list' && (
      <>
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
              // Driven by the viewer's own roster row, not by whether they
              // manage the gig -- a leader who's personally booked on their
              // own band's gig still needs to confirm like anyone else.
              // Strict === false (not just falsy): undefined means "not on
              // this gig at all" (a pure admin, or a leader not performing
              // on it), which must never read as "needs to confirm".
              const needsConfirmation = gig.my_confirmed === false && !isPast && gig.status !== 'cancelled';

              return (
                <li
                  key={gig.id}
                  ref={gig.id === firstUpcomingGig?.id ? todayRowRef : undefined}
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
                    {needsConfirmation && (
                      <span className="status-tag status-tag--needs-action">Needs action</span>
                    )}
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
                    {/* Client name and the full gig fee are business-facing --
                        only for gigs this viewer actually manages. A leader
                        merely performing elsewhere sees their own agreed fee
                        instead (same wording as GigDetailBandMember), or
                        nothing if it isn't set yet -- never the client-facing
                        total. */}
                    {canManageGig(gig) && gig.clients?.name && (
                      <p className="gig-card__client">{gig.clients.name}</p>
                    )}
                    {canManageGig(gig) && gig.fee_amount != null && (
                      <p className="gig-card__fee">
                        £{Math.round(Number(gig.fee_amount)).toLocaleString('en-GB')}
                      </p>
                    )}
                    {!canManageGig(gig) && gig.my_fee_pence != null && (
                      <p className="gig-card__fee">
                        Your fee: £{(gig.my_fee_pence / 100).toFixed(2)}
                        {gig.my_travel_cost_pence != null && ' + £' + (gig.my_travel_cost_pence / 100).toFixed(2) + ' travel'}
                      </p>
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
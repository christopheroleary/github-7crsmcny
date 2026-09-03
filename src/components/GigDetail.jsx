import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useCurrentProfile } from '../context/ProfileContext.jsx';
import { useOfflineGigData } from '../hooks/useOfflineGigData.js';
import { useIsOffline } from '../hooks/useIsOffline.js';
import { useSwipeBack } from '../hooks/useSwipeBack.js';
import CollapsibleSection from './CollapsibleSection.jsx';
import InfoTooltip from './InfoTooltip.jsx';
import { Trash2 } from '../utils/stagePlotIcons.jsx';
import VenueMap from './VenueMap.jsx';
import Avatar from './Avatar.jsx';
import GigForm from './GigForm.jsx';
import GigRoster from './GigRoster.jsx';
import GigMessages from './GigMessages.jsx';
import ArcadeSection from './arcade/ArcadeSection.jsx';
import GigWhatsAppGroup from './GigWhatsAppGroup.jsx';
import SongRequestsPanel from './SongRequestsPanel.jsx';
import GigSuppliers from './GigSuppliers.jsx';
import GigPhotos from './GigPhotos.jsx';
import GigSetlist from './GigSetlist.jsx';
import GigStagePlot from './GigStagePlot.jsx';
import TravelCalculator from './TravelCalculator.jsx';
import GigFeeSplit from './GigFeeSplit.jsx';
import GigInvoice from './GigInvoice.jsx';
import GigQuote from './GigQuote.jsx';
import GigContract from './GigContract.jsx';
import MusicianClaimsAdmin from './MusicianClaimsAdmin.jsx';
import GigTasks from './GigTasks.jsx';
import GigDetailBandMember from './GigDetailBandMember.jsx';
import { formatFullDate } from '../utils/formatDate.js';
import { confirmAsync } from '../utils/confirmService.js';
import { notify } from '../utils/toastService.js';

export default function GigDetail({ gigId, onBack, onDeleted, scrollToSection, onScrolled }) {
  const {
    gig, lineup, setlists, requirements,
    messages, reactions, tasks, claims, suppliers, songRequests, stagePlot,
    isOffline, syncing, syncedAt, error, refresh,
  } = useOfflineGigData(gigId);
  const { profile: me, isAdmin: isAdminRole, ledBandIds } = useCurrentProfile();

  // GigRoster and TravelCalculator each keep their own independent copy of
  // gig_lineup (GigRoster for its own snappy add/remove UI; TravelCalculator
  // because it needs columns -- home lat/lon, travel_miles -- this hook's
  // own lineup query doesn't select) -- neither knows when the other
  // changes the roster, nor does this hook's own `lineup` (which is what
  // "View as musician"'s picker reads below). Bumping this counter on every
  // roster mutation, threaded down as a prop, is what tells TravelCalculator
  // to refetch; calling refresh() in the same place is what keeps this
  // hook's own lineup (and so the picker) current.
  const [rosterVersion, setRosterVersion] = useState(0);
  function bumpRoster() {
    setRosterVersion((v) => v + 1);
    refresh();
  }

  // The manual "↻ Refresh" button below only ever called refresh() -- which
  // only touches this hook's own gig/lineup snapshot. GigRoster,
  // TravelCalculator, and GigSetlist all keep their own independent fetches
  // (same reason as rosterVersion above), so the button visibly changed
  // nothing about any of them. This counter, threaded into all three as an
  // extra dependency on top of whatever normally triggers their fetch, is
  // what makes the button actually force them to refetch too.
  const [manualRefreshSignal, setManualRefreshSignal] = useState(0);
  function handleManualRefresh() {
    refresh();
    setManualRefreshSignal((v) => v + 1);
  }

  // GigInvoice/GigQuote/GigContract each need the FULL clients/bands rows
  // (address, VAT rate, bank details, etc. for the printed documents) --
  // more than the `name`-only embeds useOfflineGigData fetches for the
  // shared day-sheet view. Rather than let each of those three components
  // independently repeat the entire gigs+venues+clients+bands join (the
  // exact same query, three times, on every gig detail load), it's fetched
  // once here and passed down alongside `gig` itself.
  const [docClient, setDocClient] = useState(null);
  const [docBand, setDocBand] = useState(null);
  // Gated the same way the render logic below decides admin vs musician
  // view: a plain musician never sees GigInvoice/GigQuote/GigContract at
  // all (GigDetailBandMember renders instead), so there's no point firing
  // this for them -- gig is still null on the very first render, before
  // useOfflineGigData resolves, hence the optional chaining.
  const canManageThisGig = isAdminRole || (gig?.band_id && ledBandIds.includes(gig.band_id));
  const loadDocClientBand = useCallback(async () => {
    if (!canManageThisGig) return;
    // bands(*) -- not clients(*), that table's grant is untouched -- would
    // fail outright rather than silently drop columns: bank_*/
    // stripe_connect_account_id are no longer part of the broad grant
    // (restrict_sensitive_band_columns), and Postgres checks column-level
    // SELECT privileges before expanding a wildcard, not per-column after.
    // Fetched separately below via get_band_payment_details instead.
    const { data } = await supabase
      .from('gigs')
      .select(
        'clients(*), bands(' +
          'id, name, notes, created_at, contact_email, contact_phone, address, ' +
          'vat_number, invoice_notes, invoice_name, ' +
          'fee_split_singer_bonus_pct, fee_split_dj_pct, fee_split_roadie_pct, ' +
          'fee_split_owner_profit_pct, fee_split_captain_bonus_pct, ' +
          'created_by, doc_accent_colour, doc_secondary_colour, vat_rate, ' +
          'logo_url, website_url, social_links, ' +
          'public_slug, public_bio, public_genres, public_enabled, ' +
          'stripe_connect_status' +
        ')'
      )
      .eq('id', gigId)
      .single();
    setDocClient(data?.clients || null);
    const band = data?.bands || null;
    setDocBand(band);
    // bank_*/stripe_connect_account_id are no longer part of the plain
    // bands(*) select (restrict_sensitive_band_columns) -- fetched
    // separately here and merged in. get_band_payment_details re-checks
    // admin/is_band_leader_of itself, so this is safe even though
    // canManageThisGig's own ledBandIds check is what actually gates
    // this effect running at all.
    if (band?.id) {
      const { data: paymentDetails } = await supabase.rpc('get_band_payment_details', { p_band_id: band.id });
      const details = paymentDetails?.[0];
      if (details) setDocBand((prev) => (prev ? { ...prev, ...details } : prev));
    }
  }, [gigId, canManageThisGig]);

  // Re-fetches the moment connectivity returns -- without this, a failed
  // load left docClient/docBand null forever, even once back online.
  useIsOffline(loadDocClientBand);

  useEffect(() => { loadDocClientBand(); }, [loadDocClientBand]);

  const [editing, setEditing] = useState(false);
  // Set only by the "Fix required instruments" link on a roster warning
  // (GigRoster.jsx) -- tells GigForm to scroll straight to the requirements
  // field instead of opening at the top like a normal "Edit gig" click.
  const [scrollToRequirements, setScrollToRequirements] = useState(false);
  function openEdit() {
    setScrollToRequirements(false);
    setEditing(true);
  }
  function openEditRequirements() {
    setScrollToRequirements(true);
    setEditing(true);
  }
  // Bumped when a quote converts to an invoice, forcing GigInvoice to
  // remount and pick up the newly-created invoice it wouldn't otherwise
  // know exists (they're sibling components, each loading on mount only).
  const [invoiceRefreshKey, setInvoiceRefreshKey] = useState(0);
  const [showViewAsPicker, setShowViewAsPicker] = useState(false);
  const [viewAsProfileId, setViewAsProfileId] = useState(null);
  const viewAsPickerRef = useRef(null);
  // Same click-outside-closes pattern as NotificationBell's own panel.
  useEffect(() => {
    if (!showViewAsPicker) return;
    function handleClick(e) {
      if (viewAsPickerRef.current && !viewAsPickerRef.current.contains(e.target)) {
        setShowViewAsPicker(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showViewAsPicker]);
  // Plays a quick slide-out (see .swipe-back-exiting) before actually
  // navigating away, matched to the animation's own duration. Disabled
  // while editing or viewing as another musician -- those have their own
  // way back (GigForm's Cancel, GigDetailBandMember's own swipe-back), and
  // an edge swipe there should act on whichever screen is actually showing,
  // not jump straight out of the gig entirely.
  const [exiting, setExiting] = useState(false);

  useSwipeBack(
    exiting || editing || viewAsProfileId
      ? null
      : () => {
          setExiting(true);
          setTimeout(onBack, 180);
        }
  );

  // Scroll to the section a notification pointed at (e.g. straight to the
  // roster or the claims list) once the gig has actually rendered, rather
  // than just dropping the visitor at the top of a long page. Retried a
  // couple of times over ~1s: sections below the target (TravelCalculator,
  // GigFeeSplit, etc.) fetch their own data independently and can still be
  // in a short "Loading…" state when gig first resolves, so the page grows
  // taller and the target drifts down after a single immediate scroll.
  useEffect(() => {
    if (!scrollToSection || !gig) return;
    const id = 'gig-section-' + scrollToSection;
    function tryScroll() {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    tryScroll();
    const t1 = setTimeout(tryScroll, 400);
    const t2 = setTimeout(() => { tryScroll(); onScrolled?.(); }, 1000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [scrollToSection, gig, onScrolled]);

  // ── Loading state ─────────────────────────────────────────────────────────
  // Show spinner only when we have no data at all (cache miss + first load).
  // If we have cached data, render immediately — refresh runs in background.
  if (!gig && !error) {
    return <p className="state-message">Loading gig…</p>;
  }

  if (!gig && error) {
    return (
      <div className={exiting ? 'swipe-back-exiting' : ''}>
        <button className="link-button" onClick={onBack}>← Back to gigs</button>
        <p className="state-message state-message--error" style={{ marginTop: 16 }}>
          Couldn't load gig: {error}
        </p>
      </div>
    );
  }

  // ── Self-guard: not actually authorised to manage this specific gig ────────
  // GigsList.jsx is supposed to route here only for gigs the viewer manages,
  // but it can't always know that up front (e.g. a historic gig not yet in
  // its loaded list -- see canManageGig's fallback there). This is the
  // authoritative check, since `gig` here always comes from this component's
  // own fetch. A band leader with no authority over THIS gig's band gets the
  // same day-sheet any other performer sees, instead of a management page
  // whose buttons would just fail against RLS.
  if (!isAdminRole && !(gig.band_id && ledBandIds.includes(gig.band_id))) {
    return (
      <GigDetailBandMember
        gigId={gigId}
        myProfileId={me?.id}
        onBack={onBack}
        scrollToSection={scrollToSection}
        onScrolled={onScrolled}
      />
    );
  }

  if (editing) {
    return (
      <GigForm
        gig={gig}
        scrollToRequirements={scrollToRequirements}
        onSaved={() => { setEditing(false); refresh(); }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  // ── View as musician ─────────────────────────────────────────────────────
  // Real accounts only (profile_id set) -- deps/placeholders have no login to
  // view as. Renders the exact same day-sheet a musician sees, live and
  // interactive (confirming/claiming here really does write as that
  // musician), rather than a separate read-only mock -- admins already have
  // an equivalent confirm action in the roster below, so this isn't granting
  // any new power, just making it easy to see what someone else sees.
  if (viewAsProfileId) {
    const viewAsName = lineup.find((l) => l.profile_id === viewAsProfileId)?.profiles?.full_name || 'this musician';
    return (
      <div>
        <div className="offline-banner">
          👁 Viewing this gig as <strong>{viewAsName}</strong> — this is exactly what they see.
        </div>
        <GigDetailBandMember
          gigId={gigId}
          myProfileId={viewAsProfileId}
          onBack={() => setViewAsProfileId(null)}
          backLabel="← Exit musician view"
        />
      </div>
    );
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  async function handleDelete() {
    const ok = await confirmAsync(
      'Delete this gig? This also permanently deletes its lineup, setlist, and invoice records. This cannot be undone.'
    );
    if (!ok) return;
    const { error } = await supabase.from('gigs').delete().eq('id', gigId);
    if (error) { notify("Couldn't delete: " + error.message); return; }
    onDeleted?.();
  }

  // ── Map ───────────────────────────────────────────────────────────────────
  const venue = gig.venues;
  const hasPin = venue?.latitude != null && venue?.longitude != null;

  let mapSrc = null;
  if (hasPin) {
    const minLon = venue.longitude - 0.006;
    const minLat = venue.latitude - 0.004;
    const maxLon = venue.longitude + 0.006;
    const maxLat = venue.latitude + 0.004;
    mapSrc =
      'https://www.openstreetmap.org/export/embed.html?bbox=' +
      minLon + ',' + minLat + ',' + maxLon + ',' + maxLat +
      '&marker=' + venue.latitude + ',' + venue.longitude;
  }

  const directionsHref = venue?.address
    ? 'https://www.google.com/maps/dir/?api=1&destination=' +
      encodeURIComponent(venue.address) +
      '&travelmode=driving'
    : null;

  // Satellite/Street View need an actual lat/lng (Google's Maps URLs API has
  // no address-only form for these two view types), so both are gated on
  // hasPin same as the map embed above, not just an address string.
  const satelliteHref = hasPin
    ? 'https://www.google.com/maps/@?api=1&map_action=map&center=' +
      venue.latitude + ',' + venue.longitude + '&zoom=19&basemap=satellite'
    : null;
  const streetViewHref = hasPin
    ? 'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=' +
      venue.latitude + ',' + venue.longitude
    : null;

  // Real accounts only -- deps/placeholders have no login to view as.
  const realMusicians = Array.from(
    new Map(lineup.filter((l) => l.profile_id).map((l) => [l.profile_id, l])).values()
  );

  return (
    <div className={'entity-detail' + (exiting ? ' swipe-back-exiting' : '')}>
      <button className="link-button" onClick={onBack}>← Back to gigs</button>

      {/* ── Offline / sync status bar (mirrors GigDetailBandMember) ─────────── */}
      <div className={'sync-bar ' + (isOffline ? 'sync-bar--offline' : 'sync-bar--online')}>
        <div className="sync-bar__left">
          <span className={'sync-bar__dot sync-bar__dot--' + (isOffline ? 'offline' : 'online')} />
          {isOffline ? (
            <span>
              <strong>Offline</strong>
              {syncedAt ? ' — data cached ' + formatSyncTime(syncedAt) : ' — no cached data'}
            </span>
          ) : syncing ? (
            <span>Syncing…</span>
          ) : (
            <span>Online · synced {formatSyncTime(syncedAt)}</span>
          )}
        </div>
        {!isOffline && !syncing && (
          <button className="sync-bar__refresh" onClick={handleManualRefresh} title="Refresh">
            ↻ Refresh
          </button>
        )}
      </div>

      <div className="day-sheet__section">
      <div className="section-header">
        <h2 className="section-header__title">{venue?.name ?? 'No venue set'}</h2>
        <span className={`status-tag status-tag--${gig.status}`}>{gig.status}</span>
      </div>

      {!isOffline && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap', margin: '10px 0 12px' }}>
          <button className="btn btn--primary btn--small" style={{ width: 'auto' }} onClick={openEdit}>✏️ Edit gig</button>

          <div className="viewas-picker" ref={viewAsPickerRef}>
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={() => setShowViewAsPicker((v) => !v)}
            >
              👁 View as musician
            </button>
            {showViewAsPicker && (
              <div className="viewas-menu">
                {realMusicians.length === 0 ? (
                  <p className="field__hint viewas-menu__empty">No musicians with real accounts are booked on this gig yet.</p>
                ) : (
                  realMusicians.map((l) => (
                    <button
                      key={l.profile_id}
                      type="button"
                      className="viewas-menu__item"
                      onClick={() => { setViewAsProfileId(l.profile_id); setShowViewAsPicker(false); }}
                    >
                      <Avatar url={l.profiles?.avatar_url} name={l.profiles?.full_name} />
                      {l.profiles?.full_name}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <dl className="detail-list">
        <dt>Date</dt><dd>{formatFullDate(gig.gig_date)}</dd>
        <dt>Band</dt><dd>{gig.bands?.name || '—'}</dd>
        <dt>Venue address</dt><dd>{venue?.address || '—'}</dd>
        <dt>Client</dt><dd>{gig.clients?.name || '—'}</dd>
        <dt>Times</dt>
        <dd>
          {gig.load_in_time && 'Load-in ' + gig.load_in_time.slice(0, 5) + ' · '}
          {gig.soundcheck_time && 'Soundcheck ' + gig.soundcheck_time.slice(0, 5) + ' · '}
          {gig.start_time && 'On stage ' + gig.start_time.slice(0, 5)}
          {gig.end_time && ' – ' + gig.end_time.slice(0, 5)}
        </dd>
        <dt>Fee</dt>
        <dd>{gig.fee_amount != null ? '£' + Number(gig.fee_amount).toFixed(2) : '—'}</dd>
        <dt>Guest count</dt>
        <dd>{gig.guest_count != null ? gig.guest_count : '—'}</dd>
        <dt>Event type</dt>
        <dd>{gig.event_type || '—'}</dd>
        <dt>Performance type</dt>
        <dd>{gig.performance_type || '—'}</dd>
        <dt>Mileage rate</dt>
        <dd>{gig.mileage_rate_pence ?? 35}p per mile</dd>
        <dt>Parking notes</dt><dd>{gig.parking_notes || '—'}</dd>
        <dt>Notes</dt><dd className="u-pre-line">{gig.notes || '—'}</dd>
        <dt>Sets</dt><dd>{gig.sets_info || '—'}</dd>
        <dt>Dress code</dt><dd>{gig.dress_code || '—'}</dd>
        <dt>Venue wifi</dt><dd>{gig.venue_wifi || '—'}</dd>
        {(gig.dj_song_rules || gig.first_dance_mode) && (
          <>
            <dt>DJ — do/don't play</dt><dd>{gig.dj_song_rules || '—'}</dd>
            <dt>First dance</dt>
            <dd>
              {gig.first_dance_mode === 'live' ? 'Live band' : gig.first_dance_mode === 'dj' ? 'DJ / playlist' : '—'}
              {gig.songs?.title && ' — ' + gig.songs.title + (gig.songs.artist ? ' (' + gig.songs.artist + ')' : '')}
            </dd>
          </>
        )}
        {(gig.roadie_stage_layout || gig.roadie_van_parking || gig.roadie_contact) && (
          <>
            <dt>Roadie — stage layout</dt><dd>{gig.roadie_stage_layout || '—'}</dd>
            <dt>Roadie — van parking</dt><dd>{gig.roadie_van_parking || '—'}</dd>
            <dt>Roadie — on-site contact</dt><dd>{gig.roadie_contact || '—'}</dd>
          </>
        )}
      </dl>

      {hasPin && !isOffline && (
        <VenueMap title="Venue location" src={mapSrc} height={220} />
      )}
      {hasPin && isOffline && (
        <p className="field__hint" style={{ marginTop: 8 }}>
          Map not available offline — use the directions button to navigate.
        </p>
      )}
      {!hasPin && venue?.address && (
        <p className="state-message" style={{ padding: '12px 0', textAlign: 'left' }}>
          No map pin yet — edit the venue and re-pick its address from the suggestion list to add one.
        </p>
      )}

      {(directionsHref || satelliteHref || streetViewHref) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          {directionsHref && (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => window.open(directionsHref, '_blank', 'noopener,noreferrer')}
            >
              Get directions
            </button>
          )}
          {satelliteHref && (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => window.open(satelliteHref, '_blank', 'noopener,noreferrer')}
            >
              Satellite view ↗
            </button>
          )}
          {streetViewHref && (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => window.open(streetViewHref, '_blank', 'noopener,noreferrer')}
            >
              Street View ↗
            </button>
          )}
        </div>
      )}
      </div>

      <GigRoster gigId={gigId} cachedLineup={lineup} cachedRequirements={requirements} onRosterChanged={bumpRoster} refreshSignal={manualRefreshSignal} onEditRequirements={openEditRequirements} />

      <GigTasks gigId={gigId} bandId={gig.band_id} defaultOpen={scrollToSection === 'tasks'} cachedTasks={tasks} refreshSignal={manualRefreshSignal} />

      <CollapsibleSection
        id="gig-section-chat-group"
        title="Chat & WhatsApp"
        defaultOpen={scrollToSection === 'chat'}
        titleExtra={<InfoTooltip text="The gig's group chat, plus everything needed to set up a WhatsApp group for it — group title, invite link, and one-tap invites." />}
      >
        <GigMessages gigId={gigId} bandId={gig.band_id} lineup={lineup} cachedMessages={messages} cachedReactions={reactions} refreshSignal={manualRefreshSignal} />
        <GigWhatsAppGroup gig={gig} />
      </CollapsibleSection>

      <GigSuppliers
        gigId={gigId}
        gig={gig}
        refreshSignal={manualRefreshSignal}
        defaultOpen={scrollToSection === 'suppliers'}
        cachedSuppliers={suppliers}
      />

      <CollapsibleSection
        id="gig-section-travel-fee"
        title="Travel & fee"
        defaultOpen={false}
        titleExtra={<InfoTooltip text="Each musician's travel cost home-to-venue, and how the total fee is split across the roster." />}
      >
        <TravelCalculator
          gigId={gigId}
          venueLat={venue?.latitude}
          venueLon={venue?.longitude}
          mileageRatePence={gig.mileage_rate_pence}
          rosterVersion={rosterVersion}
          refreshSignal={manualRefreshSignal}
        />

        <GigFeeSplit
          gigId={gigId}
          feeAmount={gig.fee_amount}
          bandId={gig.band_id}
          estimatedTravelPence={gig.estimated_travel_pence}
          plannedHeadcount={gig.planned_headcount}
          lineup={lineup}
        />
      </CollapsibleSection>

      <CollapsibleSection
        id="gig-section-documents"
        title="Documents"
        defaultOpen={false}
        titleExtra={<InfoTooltip text="Quote, contract, and invoice for this gig — draft, sign, and get paid, all from client and band details already on file." />}
      >
        <GigQuote
          gigId={gigId}
          gig={gig}
          client={docClient}
          band={docBand}
          gigFeeAmount={gig.fee_amount}
          onConverted={() => setInvoiceRefreshKey((k) => k + 1)}
        />

        <GigContract
          gigId={gigId}
          gig={gig}
          client={docClient}
          band={docBand}
          gigFeeAmount={gig.fee_amount}
        />

        <GigInvoice
          key={invoiceRefreshKey}
          gigId={gigId}
          gig={gig}
          client={docClient}
          band={docBand}
          lineup={lineup}
          gigFeeAmount={gig.fee_amount}
          mileageRatePence={gig.mileage_rate_pence}
        />
      </CollapsibleSection>

      <MusicianClaimsAdmin gigId={gigId} bandId={gig.band_id} lineup={lineup} defaultOpen={scrollToSection === 'claims'} cachedClaims={claims} refreshSignal={manualRefreshSignal} />

      <GigSetlist
        gigId={gigId}
        bandId={gig.band_id}
        lineup={lineup}
        cachedSetlists={setlists}
        refreshSignal={manualRefreshSignal}
        defaultOpen={scrollToSection === 'setlist'}
      />

      <GigStagePlot
        gigId={gigId}
        bandId={gig.band_id}
        gig={gig}
        venue={venue}
        lineup={lineup}
        setlists={setlists}
        defaultOpen={scrollToSection === 'stage-plot'}
        cachedStagePlot={stagePlot}
        refreshSignal={manualRefreshSignal}
      />

      <CollapsibleSection
        id="gig-section-day-of-gig"
        title="Day of gig"
        defaultOpen={scrollToSection === 'photos'}
        titleExtra={<InfoTooltip text="Everything for gig day itself — break-time games, a QR code for song requests, and a place to share photos afterwards." />}
      >
        <ArcadeSection gigId={gigId} />
        <SongRequestsPanel gig={gig} cachedRequests={songRequests} refreshSignal={manualRefreshSignal} />
        <GigPhotos gigId={gigId} bandId={gig.band_id} gig={gig} lineup={lineup} refreshSignal={manualRefreshSignal} />
      </CollapsibleSection>

      <div className="form-actions">
        {!isOffline && (
          <>
            <button className="btn btn--ghost btn--small" onClick={openEdit}>✏️ Edit gig</button>
            <button className="btn btn--ghost-danger btn--small" style={{ gap: 6 }} onClick={handleDelete}>
              <Trash2 size={14} />
              Delete gig
            </button>
          </>
        )}
        {isOffline && (
          <p className="field__hint">Connect to delete this gig.</p>
        )}
      </div>
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
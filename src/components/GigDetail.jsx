import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { useOfflineGigData } from '../hooks/useOfflineGigData.js';
import GigForm from './GigForm.jsx';
import GigRoster from './GigRoster.jsx';
import GigWhatsAppGroup from './GigWhatsAppGroup.jsx';
import GigSetlist from './GigSetlist.jsx';
import TravelCalculator from './TravelCalculator.jsx';
import GigFeeSplit from './GigFeeSplit.jsx';
import GigInvoice from './GigInvoice.jsx';
import GigQuote from './GigQuote.jsx';
import GigContract from './GigContract.jsx';
import MusicianClaimsAdmin from './MusicianClaimsAdmin.jsx';
import GigDetailBandMember from './GigDetailBandMember.jsx';
import { formatFullDate } from '../utils/formatDate.js';
import { confirmAsync } from '../utils/confirmService.js';
import { notify } from '../utils/toastService.js';

export default function GigDetail({ gigId, onBack, onDeleted, scrollToSection, onScrolled }) {
  const { gig, lineup, isOffline, syncing, syncedAt, error, refresh } =
    useOfflineGigData(gigId);

  const [editing, setEditing] = useState(false);
  // Bumped when a quote converts to an invoice, forcing GigInvoice to
  // remount and pick up the newly-created invoice it wouldn't otherwise
  // know exists (they're sibling components, each loading on mount only).
  const [invoiceRefreshKey, setInvoiceRefreshKey] = useState(0);
  const [showViewAsPicker, setShowViewAsPicker] = useState(false);
  const [viewAsProfileId, setViewAsProfileId] = useState(null);

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
      <div>
        <button className="link-button" onClick={onBack}>← Back to gigs</button>
        <p className="state-message state-message--error" style={{ marginTop: 16 }}>
          Couldn't load gig: {error}
        </p>
      </div>
    );
  }

  if (editing) {
    return (
      <GigForm
        gig={gig}
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
    <div className="entity-detail">
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
          <button className="sync-bar__refresh" onClick={refresh} title="Refresh">
            ↻ Refresh
          </button>
        )}
      </div>

      {!isOffline && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '4px 0 12px' }}>
          <button className="btn btn--primary btn--small" onClick={() => setEditing(true)}>Edit gig</button>
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={() => setShowViewAsPicker((v) => !v)}
          >
            👁 View as musician
          </button>
        </div>
      )}

      {showViewAsPicker && (
        <div className="inline-subform" style={{ marginBottom: 12 }}>
          {realMusicians.length === 0 ? (
            <p className="field__hint">No musicians with real accounts are booked on this gig yet.</p>
          ) : (
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  setViewAsProfileId(e.target.value);
                  setShowViewAsPicker(false);
                }
              }}
            >
              <option value="">Choose a musician…</option>
              {realMusicians.map((l) => (
                <option key={l.profile_id} value={l.profile_id}>{l.profiles?.full_name}</option>
              ))}
            </select>
          )}
        </div>
      )}

      <div className="section-header">
        <h2 className="section-header__title">{venue?.name ?? 'No venue set'}</h2>
        <span className={`status-tag status-tag--${gig.status}`}>{gig.status}</span>
      </div>

      <dl className="detail-list">
        <dt>Date</dt><dd>{formatFullDate(gig.gig_date)}</dd>
        <dt>Band</dt><dd>{gig.bands?.name || '—'}</dd>
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
        <dt>Venue address</dt><dd>{venue?.address || '—'}</dd>
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
        <iframe
          title="Venue location"
          width="100%"
          height="220"
          style={{ border: 0, borderRadius: 12, marginTop: 12 }}
          loading="lazy"
          src={mapSrc}
        />
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

      <div id="gig-section-roster">
        <GigRoster gigId={gigId} />
      </div>

      <GigWhatsAppGroup gig={gig} />

      <TravelCalculator
        gigId={gigId}
        venueLat={venue?.latitude}
        venueLon={venue?.longitude}
        mileageRatePence={gig.mileage_rate_pence}
      />

      <GigFeeSplit
        gigId={gigId}
        feeAmount={gig.fee_amount}
        bandId={gig.band_id}
        estimatedTravelPence={gig.estimated_travel_pence}
        plannedHeadcount={gig.planned_headcount}
      />

      <div id="gig-section-claims">
        <MusicianClaimsAdmin gigId={gigId} />
      </div>

      <GigQuote
        gigId={gigId}
        gigFeeAmount={gig.fee_amount}
        onConverted={() => setInvoiceRefreshKey((k) => k + 1)}
      />

      <GigContract
        gigId={gigId}
        gigFeeAmount={gig.fee_amount}
      />

      <GigInvoice
        key={invoiceRefreshKey}
        gigId={gigId}
        gigFeeAmount={gig.fee_amount}
        mileageRatePence={gig.mileage_rate_pence}
      />

      <GigSetlist gigId={gigId} bandId={gig.band_id} />

      <div className="form-actions">
        {!isOffline && (
          <button className="btn btn--ghost" onClick={handleDelete}>Delete gig</button>
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
import { useState } from 'react';
import { supabase } from '../supabaseClient';
import { useOfflineGigData } from '../hooks/useOfflineGigData.js';
import GigForm from './GigForm.jsx';
import GigRoster from './GigRoster.jsx';
import GigSetlist from './GigSetlist.jsx';
import TravelCalculator from './TravelCalculator.jsx';
import GigInvoice from './GigInvoice.jsx';
import MusicianClaimsAdmin from './MusicianClaimsAdmin.jsx';
import { formatFullDate } from '../utils/formatDate.js';

export default function GigDetail({ gigId, onBack, onDeleted }) {
  const { gig, requirements, isOffline, syncing, syncedAt, error, refresh } =
    useOfflineGigData(gigId);

  const [editing, setEditing] = useState(false);

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

  // ── Delete ────────────────────────────────────────────────────────────────
  async function handleDelete() {
    const ok = window.confirm(
      'Delete this gig? This also permanently deletes its lineup, setlist, and invoice records. This cannot be undone.'
    );
    if (!ok) return;
    const { error } = await supabase.from('gigs').delete().eq('id', gigId);
    if (error) { alert("Couldn't delete: " + error.message); return; }
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
        <dt>Mileage rate</dt>
        <dd>{gig.mileage_rate_pence ?? 35}p per mile</dd>
        <dt>Venue address</dt><dd>{venue?.address || '—'}</dd>
        <dt>Parking notes</dt><dd>{gig.parking_notes || '—'}</dd>
        <dt>Notes</dt><dd>{gig.notes || '—'}</dd>
        <dt>Instruments needed</dt>
        <dd>
          {requirements.length === 0
            ? '—'
            : requirements.map((r, i) => (
                <span key={i} className="tag" style={{ marginRight: 6 }}>
                  {r.instruments?.name} × {r.quantity}
                </span>
              ))}
        </dd>
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

      {directionsHref && (
        <button
          type="button"
          className="btn btn--primary"
          style={{ marginTop: 12 }}
          onClick={() => window.open(directionsHref, '_blank', 'noopener,noreferrer')}
        >
          Get directions
        </button>
      )}

      <GigRoster gigId={gigId} />

      <TravelCalculator
        gigId={gigId}
        venueLat={venue?.latitude}
        venueLon={venue?.longitude}
        mileageRatePence={gig.mileage_rate_pence}
      />

      <MusicianClaimsAdmin gigId={gigId} />

      <GigSetlist gigId={gigId} bandId={gig.band_id} />

      <GigInvoice
        gigId={gigId}
        gigFeeAmount={gig.fee_amount}
        mileageRatePence={gig.mileage_rate_pence}
      />

      <div className="form-actions">
        {!isOffline && (
          <>
            <button className="btn btn--ghost" onClick={handleDelete}>Delete gig</button>
            <button className="btn btn--primary" onClick={() => setEditing(true)}>Edit gig</button>
          </>
        )}
        {isOffline && (
          <p className="field__hint">Connect to edit or delete this gig.</p>
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
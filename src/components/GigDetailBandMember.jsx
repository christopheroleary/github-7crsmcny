import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { useCurrentProfile } from '../context/ProfileContext.jsx';
import { useOfflineGigData } from '../hooks/useOfflineGigData.js';
import { useSwipeBack } from '../hooks/useSwipeBack.js';
import { usePullToRefresh } from '../hooks/usePullToRefresh.js';
import useBandBackingTrackSongIds from '../hooks/useBandBackingTrackSongIds.js';
import BackingTrackPlayer from './BackingTrackPlayer.jsx';
import PerformanceMode from './PerformanceMode.jsx';
import PullToRefreshIndicator from './PullToRefreshIndicator.jsx';
import GigMessages from './GigMessages.jsx';
import ArcadeSection from './arcade/ArcadeSection.jsx';
import GigSuppliers from './GigSuppliers.jsx';
import MusicianClaim from './MusicianClaim.jsx';
import NearbyPlaces from './NearbyPlaces.jsx';
import Avatar from './Avatar.jsx';
import { notify } from '../utils/toastService.js';
import { toWhatsAppNumber } from '../utils/phone.js';

function vocalLabel(role) {
  if (role === 'lead') return 'Lead vocals';
  if (role === 'backing') return 'Backing vocals';
  return null;
}

// Compact call/text/WhatsApp links for a roster row -- deliberately just a
// few characters each so this can sit on the same line as the musician's
// name without pushing the row wide enough to wrap the Confirmed/Pending
// badge onto its own line (the previous full phone-number string, appended
// after the instrument line, did exactly that).
function RosterPhoneLinks({ phone }) {
  const wa = toWhatsAppNumber(phone);
  return (
    <span className="day-sheet__roster-phone" onClick={(e) => e.stopPropagation()}>
      <a href={'tel:' + phone} title={'Call ' + phone}>Call</a>
      <a href={'sms:' + phone} title={'Text ' + phone}>Text</a>
      {wa && (
        <a href={'https://wa.me/' + wa} target="_blank" rel="noopener noreferrer" title="WhatsApp">
          WhatsApp
        </a>
      )}
    </span>
  );
}

function formatTime(t) {
  if (!t) return null;
  return t.slice(0, 5);
}

function formatDate(d) {
  if (!d) return '—';
  const date = new Date(d + 'T00:00:00');
  return date.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

function formatSyncTime(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now - d;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return diffMins + ' minute' + (diffMins === 1 ? '' : 's') + ' ago';
  if (diffHours < 24) return diffHours + ' hour' + (diffHours === 1 ? '' : 's') + ' ago';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function GigDetailBandMember({ gigId, myProfileId, onBack, scrollToSection, onScrolled, backLabel = '← Back to my gigs' }) {
  const { gig, lineup, setlists, syncedAt, isOffline, syncing, error, refresh } = useOfflineGigData(gigId);
  const { isBandLeader, ledBandIds } = useCurrentProfile();
  // True whenever a band leader lands here for a gig outside band(s) they
  // actually lead -- either GigsList routed them here directly, or
  // GigDetail.jsx's self-guard demoted them from the management view.
  // Without this they'd just see an unexplained downgrade from their usual
  // page with no clue why, which reads as broken even though it's correct.
  const viewingOutsideLedBand = isBandLeader && gig?.band_id && !ledBandIds.includes(gig.band_id);
  const [confirming, setConfirming] = useState(false);
  // Plays a quick slide-out (see .swipe-back-exiting) before actually
  // navigating away, so an edge swipe doesn't just instantly snap to the
  // list -- matched to the animation's own duration.
  const [exiting, setExiting] = useState(false);
  useSwipeBack(
    exiting
      ? null
      : () => {
          setExiting(true);
          setTimeout(onBack, 180);
        }
  );
  // Holds the lineup row id the user just confirmed, so the banner can show
  // the confirmed state before the refetch lands. Cleared only on failure.
  const [justConfirmedId, setJustConfirmedId] = useState(null);
  const [showLyricsId, setShowLyricsId] = useState(null);
  const [showPlayerId, setShowPlayerId] = useState(null);
  const [showTrackId, setShowTrackId] = useState(null);
  const [showPerformanceMode, setShowPerformanceMode] = useState(false);
  // Which songs actually have a band backing track -- read-only here (no
  // Edit/upload on this view at all), same has-track gating as GigSetlist.jsx
  // so the button only appears where there's actually something to play.
  const { songIds: backingTrackSongIds, reload: reloadBackingTracks } = useBandBackingTrackSongIds(gig?.band_id);

  // The manual "↻ Refresh" button below used to only call refresh() --
  // which is enough on its own for the roster and setlist above (both read
  // straight off useOfflineGigData's shared state here, unlike GigDetail.jsx's
  // admin view, so there's no separate copy of gig_lineup to go stale). But
  // GigSuppliers, MusicianClaim, and the backing-track availability check
  // all keep their own independent fetches, same reason as GigRoster/
  // TravelCalculator/GigSetlist did on the admin page -- so the button still
  // didn't touch any of them.
  const [manualRefreshSignal, setManualRefreshSignal] = useState(0);
  function handleManualRefresh() {
    refresh();
    reloadBackingTracks();
    setManualRefreshSignal((v) => v + 1);
  }

  // Emergency backup for the button above -- a phone's native "pull down to
  // refresh" gesture, wired to the exact same handler. Disabled while
  // offline (nothing to actually re-fetch) and while `gig` hasn't loaded yet.
  const { pullDistance, refreshing: pullRefreshing, threshold: pullThreshold } =
    usePullToRefresh(handleManualRefresh, { disabled: isOffline || !gig });

  // Scroll to the section a notification pointed at (e.g. straight to the
  // roster or your claim) once the gig has actually rendered. Placed above
  // the loading/error early returns below to keep this an unconditional
  // hook call, per the rules of hooks. Retried a couple of times over ~1s
  // since sections below the target can still be loading their own data
  // when gig first resolves, growing the page and drifting the target down
  // after a single immediate scroll (see the matching note in GigDetail.jsx).
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

  async function handleConfirm(myEntry) {
    // Optimistic: flip the banner immediately rather than making the musician
    // watch a spinner through a write round trip AND the full refetch that
    // follows it. Confirming availability is the single most common thing a
    // musician does in this app, often on a weak venue connection where those
    // two trips are the difference between "instant" and "did that work?".
    // Rolled back below if the write actually fails.
    setJustConfirmedId(myEntry.id);
    setConfirming(true);
    const { error } = await supabase.from('gig_lineup').update({ confirmed: true }).eq('id', myEntry.id);
    setConfirming(false);
    if (error) {
      setJustConfirmedId(null);
      notify("Couldn't confirm: " + error.message);
      return;
    }
    refresh();
  }

  // Loading state — show cache immediately if available, show spinner if not
  if (!gig && !error) {
    return <p className="state-message">Loading gig details…</p>;
  }

  if (!gig && error) {
    return (
      <div className={exiting ? 'swipe-back-exiting' : ''}>
        <button className="link-button" onClick={onBack}>{backLabel}</button>
        <div className="day-sheet__section" style={{ marginTop: 16 }}>
          <p className="state-message state-message--error" style={{ padding: 0 }}>{error}</p>
        </div>
      </div>
    );
  }

  const venue = gig.venues;
  const hasPin = venue?.latitude != null && venue?.longitude != null;

  let mapSrc = null;
  if (hasPin) {
    const minLon = venue.longitude - 0.006;
    const minLat = venue.latitude - 0.004;
    const maxLon = venue.longitude + 0.006;
    const maxLat = venue.latitude + 0.004;
    mapSrc = 'https://www.openstreetmap.org/export/embed.html?bbox=' +
      minLon + ',' + minLat + ',' + maxLon + ',' + maxLat +
      '&marker=' + venue.latitude + ',' + venue.longitude;
  }

  const directionsHref = venue?.address
    ? 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(venue.address) + '&travelmode=driving'
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

  const rawMyEntry = lineup.find((l) => l.profile_id === myProfileId) || null;
  // Overlay the optimistic confirm until the refetch catches up.
  const myEntry =
    rawMyEntry && justConfirmedId === rawMyEntry.id && !rawMyEntry.confirmed
      ? { ...rawMyEntry, confirmed: true }
      : rawMyEntry;
  const myTravel = myEntry?.travel_cost_pence;

  // Captain always leads the list; a pure DJ/roadie (no instrument, so not
  // actually performing) sinks to the bottom. Everyone else keeps roster order.
  function rosterSortKey(entry) {
    if (entry.is_captain) return 0;
    if (!entry.instrument_id && (entry.is_dj || entry.is_roadie)) return 2;
    return 1;
  }
  const sortedLineup = [...lineup].sort((a, b) => rosterSortKey(a) - rosterSortKey(b));

  return (
    <div className={'day-sheet' + (exiting ? ' swipe-back-exiting' : '')}>
      <PullToRefreshIndicator pullDistance={pullDistance} refreshing={pullRefreshing} threshold={pullThreshold} />
      <button className="link-button" onClick={onBack}>{backLabel}</button>

      {/* Sync status bar */}
      <div className={'sync-bar ' + (isOffline ? 'sync-bar--offline' : 'sync-bar--online')}>
        <div className="sync-bar__left">
          <span className={'sync-bar__dot sync-bar__dot--' + (isOffline ? 'offline' : 'online')} />
          {isOffline ? (
            <span>
              <strong>Offline</strong>
              {syncedAt ? ' — showing data cached ' + formatSyncTime(syncedAt) : ' — no cached data'}
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

      {/* Offline warning if data might be stale */}
      {isOffline && syncedAt && (
        <div className="offline-banner">
          ⚠ You're offline. This data was last updated on{' '}
          <strong>
            {new Date(syncedAt).toLocaleDateString('en-GB', {
              weekday: 'short', day: 'numeric', month: 'short',
              hour: '2-digit', minute: '2-digit',
            })}
          </strong>
          . Maps and media players won't work without a connection.
        </div>
      )}

      {viewingOutsideLedBand && (
        <div className="offline-banner">
          You lead another band, but this gig belongs to <strong>{gig.bands?.name || 'a different band'}</strong> — you're viewing it as a performer, not a manager.
        </div>
      )}

      {/* Confirmation banner */}
      {myEntry && (
        <div className={'day-sheet__confirm-banner day-sheet__confirm-banner--' + (myEntry.confirmed ? 'yes' : 'no')}>
          {myEntry.confirmed ? (
            <span>✓ You are confirmed on this gig as <strong>{myEntry.instruments?.name || 'musician'}</strong></span>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <span>You haven't confirmed this gig yet.</span>
              {!isOffline && (
                <button className="btn btn--primary btn--small" onClick={() => handleConfirm(myEntry)} disabled={confirming}>
                  {confirming ? 'Confirming…' : "Confirm I'm available"}
                </button>
              )}
              {isOffline && <span className="field__hint">Connect to confirm.</span>}
            </div>
          )}
          {myEntry.fee_pence != null && (
            <p style={{ margin: '8px 0 0' }}>
              <strong>Your fee: £{(myEntry.fee_pence / 100).toFixed(2)}</strong>
              {myEntry.travel_cost_pence != null && ' + £' + (myEntry.travel_cost_pence / 100).toFixed(2) + ' travel'}
            </p>
          )}
          {myEntry.confirmed && myEntry.confirmed_fee_pence != null && myEntry.fee_pence < myEntry.confirmed_fee_pence && (
            <p className="status-tag status-tag--cancelled" style={{ marginTop: 8, display: 'inline-block' }}>
              ⚠ Your fee was reduced from £{(myEntry.confirmed_fee_pence / 100).toFixed(2)} to £{(myEntry.fee_pence / 100).toFixed(2)} since you confirmed
            </p>
          )}
        </div>
      )}

      {/* Event header */}
      <div className="day-sheet__header">
        <div>
          <p className="day-sheet__band">{gig.bands?.name || ''}</p>
          <h2 className="day-sheet__venue">{venue?.name ?? 'Venue TBC'}</h2>
          <p className="day-sheet__date">{formatDate(gig.gig_date)}</p>
        </div>
        <span className={'status-tag status-tag--' + gig.status}>{gig.status}</span>
      </div>

      {/* Schedule */}
      <div className="day-sheet__section">
        <h3 className="day-sheet__section-title">Schedule</h3>
        <div className="day-sheet__times">
          {gig.load_in_time && (
            <div className="day-sheet__time-row">
              <span className="day-sheet__time-label">Load in</span>
              <span className="day-sheet__time-value">{formatTime(gig.load_in_time)}</span>
            </div>
          )}
          {gig.soundcheck_time && (
            <div className="day-sheet__time-row">
              <span className="day-sheet__time-label">Soundcheck</span>
              <span className="day-sheet__time-value">{formatTime(gig.soundcheck_time)}</span>
            </div>
          )}
          {gig.start_time && (
            <div className="day-sheet__time-row day-sheet__time-row--main">
              <span className="day-sheet__time-label">On stage</span>
              <span className="day-sheet__time-value">{formatTime(gig.start_time)}</span>
            </div>
          )}
          {gig.end_time && (
            <div className="day-sheet__time-row">
              <span className="day-sheet__time-label">Finish</span>
              <span className="day-sheet__time-value">{formatTime(gig.end_time)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Venue & travel */}
      <div className="day-sheet__section">
        <h3 className="day-sheet__section-title">Venue</h3>
        {venue?.address && <p className="day-sheet__text">{venue.address}</p>}
        {gig.parking_notes && (
          <p className="day-sheet__text day-sheet__text--muted">
            <strong>Parking:</strong> {gig.parking_notes}
          </p>
        )}
        {gig.venue_wifi && (
          <p className="day-sheet__text day-sheet__text--muted">
            <strong>Wifi:</strong> {gig.venue_wifi}
          </p>
        )}
        {myTravel != null && (
          <p className="day-sheet__text">
            <strong>Your travel:</strong> £{(myTravel / 100).toFixed(2)}
          </p>
        )}
        {hasPin && !isOffline && (
          <iframe
            title="Venue map"
            width="100%"
            height="200"
            style={{ border: 0, borderRadius: 10, marginTop: 10 }}
            loading="lazy"
            src={mapSrc}
          />
        )}
        {hasPin && isOffline && (
          <p className="field__hint" style={{ marginTop: 8 }}>
            Map not available offline — use the directions button to navigate.
          </p>
        )}
        {(directionsHref || satelliteHref || streetViewHref) && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            {directionsHref && (
              <button
                type="button"
                className="btn btn--primary btn--small"
                onClick={() => window.open(directionsHref, '_blank', 'noopener,noreferrer')}
              >
                Get directions ↗
              </button>
            )}
            {satelliteHref && (
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={() => window.open(satelliteHref, '_blank', 'noopener,noreferrer')}
              >
                Satellite view ↗
              </button>
            )}
            {streetViewHref && (
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={() => window.open(streetViewHref, '_blank', 'noopener,noreferrer')}
              >
                Street View ↗
              </button>
            )}
          </div>
        )}
      </div>

      {/* Notes */}
      {(gig.notes || gig.clients?.name || gig.sets_info || gig.dress_code) && (
        <div className="day-sheet__section">
          <h3 className="day-sheet__section-title">Event notes</h3>
          {gig.clients?.name && (
            <p className="day-sheet__text">
              <strong>Client:</strong> {gig.clients.name}
            </p>
          )}
          {gig.sets_info && (
            <p className="day-sheet__text">
              <strong>Sets:</strong> {gig.sets_info}
            </p>
          )}
          {gig.dress_code && (
            <p className="day-sheet__text">
              <strong>Dress code:</strong> {gig.dress_code}
            </p>
          )}
          {gig.notes && <p className="day-sheet__text u-pre-line">{gig.notes}</p>}
        </div>
      )}

      {/* Roster */}
      <div className="day-sheet__section" id="gig-section-roster">
        <h3 className="day-sheet__section-title">Who's on this gig</h3>
        <ul className="day-sheet__roster">
        {sortedLineup.map((l) => (
          <li key={l.id} className="day-sheet__roster-row">
            <div style={{ display: 'flex', gap: 10, minWidth: 0 }}>
              {l.profile_id && <Avatar url={l.profiles?.avatar_url} name={l.profiles?.full_name} />}
            <div>
              <span className="day-sheet__roster-name">
                {l.profiles?.full_name || l.placeholder_musicians?.name}
                {l.is_captain && (
                  <span className="status-tag" style={{ marginLeft: 6, background: 'var(--rust)22', color: 'var(--rust)', border: '1px solid var(--rust)44' }}>
                    ★ Captain
                  </span>
                )}
                {l.profiles?.share_phone_on_daysheet && l.profiles?.phone && (
                  <RosterPhoneLinks phone={l.profiles.phone} />
                )}
              </span>
              <span className="day-sheet__roster-instrument">
                {[l.instruments?.name, l.is_dj && 'DJ', l.is_roadie && 'Roadie', vocalLabel(l.vocal_role)].filter(Boolean).join(' · ')}
              </span>
            </div>
            </div>
            <span className={'status-tag status-tag--' + (l.confirmed ? 'confirmed' : 'inquiry')}>
              {l.confirmed ? 'Confirmed' : 'Pending'}
            </span>
          </li>
        ))}
          {lineup.length === 0 && <li className="state-message">No one booked yet.</li>}
        </ul>
      </div>

      {/* Setlists */}
      {setlists.length > 0 && (
        <div className="day-sheet__section">
          <h3 className="day-sheet__section-title">Setlist</h3>
          {/* Not gated on isOffline -- lyrics/key/bpm are already cached
              (the whole point of useOfflineGigData), so the core reading
              purpose of this works fine with no connection. PerformanceMode
              itself hides just the Listen/Backing track buttons offline,
              matching the same gate the plain list view above already
              applies to those two per-song. */}
          <button
            type="button"
            className="btn btn--primary"
            style={{ marginBottom: 12 }}
            onClick={() => setShowPerformanceMode(true)}
          >
            ▶ Performance mode
          </button>
          {setlists.map((sl) => (
            <div key={sl.id} className="day-sheet__set">
              <p className="day-sheet__set-name">{sl.name}</p>
              <ol className="day-sheet__songs">
                {sl.setlist_items.map((item) => {
                  const song = item.songs;
                  const isShowingLyrics = showLyricsId === item.id;
                  const isShowingPlayer = showPlayerId === item.id;
                  return (
                    <li key={item.id} className="day-sheet__song">
                      <div className="day-sheet__song-row">
                        <span className="day-sheet__song-title">
                          {song?.title}
                          {song?.artist && (
                            <span className="day-sheet__song-artist"> — {song.artist}</span>
                          )}
                          {song?.original_key && (
                            <span className="setlist-song__key">{song.original_key}</span>
                          )}
                        </span>
                        <div className="day-sheet__song-actions">
                          {song?.reference_url && !isOffline && (
                            <button
                              className="link-button"
                              onClick={() => setShowPlayerId(isShowingPlayer ? null : item.id)}
                            >
                              {isShowingPlayer ? 'Hide' : 'Listen'}
                            </button>
                          )}
                          {song?.lyrics && (
                            <button
                              className="link-button"
                              onClick={() => setShowLyricsId(isShowingLyrics ? null : item.id)}
                            >
                              {isShowingLyrics ? 'Hide' : 'Lyrics'}
                            </button>
                          )}
                          {song && gig.band_id && !isOffline && backingTrackSongIds?.has(song.id) && (
                            <button
                              className="link-button"
                              onClick={() => setShowTrackId(showTrackId === item.id ? null : item.id)}
                            >
                              {showTrackId === item.id ? 'Hide' : 'Backing track'}
                            </button>
                          )}
                        </div>
                      </div>
                      {isShowingPlayer && song?.reference_url && !isOffline && (
                        <ReferencePlayer url={song.reference_url} />
                      )}
                      {isShowingLyrics && song?.lyrics && (
                        <LyricsView text={song.lyrics} />
                      )}
                      {showTrackId === item.id && song && gig.band_id && !isOffline && (
                        <BackingTrackPlayer band={{ id: gig.band_id }} song={song} />
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </div>
      )}

      {showPerformanceMode && (
        <PerformanceMode
          setlists={setlists}
          bandId={gig.band_id}
          backingTrackSongIds={backingTrackSongIds}
          isOffline={isOffline}
          onClose={() => setShowPerformanceMode(false)}
        />
      )}

      {/* Gig chat — only when online */}
      {!isOffline && (
        <GigMessages gigId={gigId} bandId={gig.band_id} lineup={lineup} />
      )}

      {/* Break-time games -- deliberately NOT gated on isOffline like chat
          above. The games themselves are pure client-side canvas/DOM logic
          with no network calls during play, which is the whole point of a
          gig-break time-killer at a venue with bad signal; only submitting
          the finished score needs a connection, and ArcadeSection already
          handles that failing gracefully. */}
      <ArcadeSection gigId={gigId} />

      {/* Suppliers (photographer, DJ, etc.) — only when online. Always
          read-only here, same as venue/client info elsewhere on this page:
          this component doesn't know whether it's rendering for a real
          musician or an admin's "view as" preview (that only swaps
          myProfileId, not role context), so management stays on the
          admin-facing gig view regardless of who's actually signed in. */}
      {!isOffline && (
        <GigSuppliers gigId={gigId} gig={gig} readOnly refreshSignal={manualRefreshSignal} />
      )}

      {/* Payment claim — only when online */}
      <div id="gig-section-claims">
        {!isOffline && (
          <MusicianClaim gigId={gigId} myProfileId={myProfileId} refreshSignal={manualRefreshSignal} />
        )}
        {isOffline && (
          <div className="day-sheet__section">
            <h3 className="day-sheet__section-title">My payment claim</h3>
            <p className="field__hint">Payment claims require a connection.</p>
          </div>
        )}
      </div>

      {/* Confirm button repeated at bottom */}
      {myEntry && !myEntry.confirmed && !isOffline && (
        <div className="day-sheet__section" style={{ paddingTop: 8 }}>
          <button
            className="btn btn--primary"
            onClick={() => handleConfirm(myEntry)}
            disabled={confirming}
          >
            {confirming ? 'Confirming…' : "Confirm I'm available"}
          </button>
        </div>
      )}

      {hasPin && (
        <NearbyPlaces lat={venue.latitude} lon={venue.longitude} venueId={venue.id} isOffline={isOffline} venueName={venue.name} />
      )}
    </div>
  );
}

function ReferencePlayer({ url }) {
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
  if (ytMatch) {
    return (
      <div className="reference-player" style={{ marginTop: 8 }}>
        <iframe
          width="100%"
          height="180"
          src={'https://www.youtube.com/embed/' + ytMatch[1]}
          title="Song reference"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }
  const spotifyMatch = url.match(/open\.spotify\.com\/(track|album|playlist)\/([\w]+)/);
  if (spotifyMatch) {
    return (
      <div className="reference-player" style={{ marginTop: 8 }}>
        <iframe
          width="100%"
          height="152"
          src={'https://open.spotify.com/embed/' + spotifyMatch[1] + '/' + spotifyMatch[2]}
          title="Song reference"
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        />
      </div>
    );
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="link-button" style={{ display: 'block', marginTop: 6 }}>
      Open reference ↗
    </a>
  );
}

function LyricsView({ text }) {
  if (!text) return null;
  return (
    <div className="lyrics-view" style={{ marginTop: 8 }}>
      {text.split('\n').map((line, i) =>
        /^\[.+\]$/.test(line.trim())
          ? <p key={i} className="lyrics-view__section">{line}</p>
          : <p key={i} className="lyrics-view__line">{line || '\u00A0'}</p>
      )}
    </div>
  );
}
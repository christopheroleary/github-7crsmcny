import { useState } from 'react';
import { supabase } from '../supabaseClient';
import { useOfflineGigData } from '../hooks/useOfflineGigData.js';
import MusicianClaim from './MusicianClaim.jsx';

function vocalLabel(role) {
  if (role === 'lead') return 'Lead vocals';
  if (role === 'backing') return 'Backing vocals';
  return null;
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

export default function GigDetailBandMember({ gigId, myProfileId, onBack }) {
  const { gig, lineup, setlists, syncedAt, isOffline, syncing, error, refresh } = useOfflineGigData(gigId);
  const [confirming, setConfirming] = useState(false);
  const [showLyricsId, setShowLyricsId] = useState(null);
  const [showPlayerId, setShowPlayerId] = useState(null);

  async function handleConfirm(myEntry) {
    setConfirming(true);
    const { error } = await supabase.from('gig_lineup').update({ confirmed: true }).eq('id', myEntry.id);
    setConfirming(false);
    if (error) {
      alert("Couldn't confirm: " + error.message);
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
      <div>
        <button className="link-button" onClick={onBack}>← Back to my gigs</button>
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

  const myEntry = lineup.find((l) => l.profile_id === myProfileId) || null;
  const myTravel = myEntry?.travel_cost_pence;

  return (
    <div className="day-sheet">
      <button className="link-button" onClick={onBack}>← Back to my gigs</button>

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
          <button className="sync-bar__refresh" onClick={refresh} title="Refresh">
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
        {directionsHref && (
          <button
            type="button"
            className="btn btn--primary btn--small"
            style={{ marginTop: 10 }}
            onClick={() => window.open(directionsHref, '_blank', 'noopener,noreferrer')}
          >
            Get directions ↗
          </button>
        )}
      </div>

      {/* Notes */}
      {(gig.notes || gig.clients?.name) && (
        <div className="day-sheet__section">
          <h3 className="day-sheet__section-title">Event notes</h3>
          {gig.clients?.name && (
            <p className="day-sheet__text">
              <strong>Client:</strong> {gig.clients.name}
            </p>
          )}
          {gig.notes && <p className="day-sheet__text u-pre-line">{gig.notes}</p>}
        </div>
      )}

      {/* Roster */}
      <div className="day-sheet__section">
        <h3 className="day-sheet__section-title">Who's on this gig</h3>
        <ul className="day-sheet__roster">
        {lineup.map((l) => (
          <li key={l.id} className="day-sheet__roster-row">
            <div>
              <span className="day-sheet__roster-name">
                {l.profiles?.full_name || l.placeholder_musicians?.name}
              </span>
              <span className="day-sheet__roster-instrument">
                {[l.instruments?.name, vocalLabel(l.vocal_role)].filter(Boolean).join(' · ')}
              </span>
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
                        </div>
                      </div>
                      {isShowingPlayer && song?.reference_url && !isOffline && (
                        <ReferencePlayer url={song.reference_url} />
                      )}
                      {isShowingLyrics && song?.lyrics && (
                        <LyricsView text={song.lyrics} />
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </div>
      )}

      {/* Payment claim — only when online */}
      {!isOffline && (
        <MusicianClaim gigId={gigId} myProfileId={myProfileId} />
      )}
      {isOffline && (
        <div className="day-sheet__section">
          <h3 className="day-sheet__section-title">My payment claim</h3>
          <p className="field__hint">Payment claims require a connection.</p>
        </div>
      )}

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
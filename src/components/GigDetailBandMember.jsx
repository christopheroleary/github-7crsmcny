import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import MusicianClaim from './MusicianClaim.jsx';

function formatTime(t) {
  if (!t) return null;
  return t.slice(0, 5);
}

function formatDate(d) {
  if (!d) return '—';
  const date = new Date(d + 'T00:00:00');
  return date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export default function GigDetailBandMember({ gigId, myProfileId, onBack }) {
  const [gig, setGig] = useState(null);
  const [lineup, setLineup] = useState([]);
  const [setlists, setSetlists] = useState([]);
  const [myEntry, setMyEntry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [showLyricsId, setShowLyricsId] = useState(null);
  const [showPlayerId, setShowPlayerId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);

    const { data: gigData, error: gigError } = await supabase
      .from('gigs')
      .select('id, gig_date, start_time, end_time, load_in_time, soundcheck_time, status, parking_notes, notes, venues(name, address, latitude, longitude), bands(name)')
      .eq('id', gigId)
      .single();

    if (gigError) {
      setError(gigError.message);
      setLoading(false);
      return;
    }
    setGig(gigData);

    const { data: lineupData } = await supabase
      .from('gig_lineup')
      .select('id, profile_id, confirmed, instrument_id, travel_cost_pence, profiles(full_name), instruments(name)')
      .eq('gig_id', gigId);

    setLineup(lineupData || []);
    setMyEntry((lineupData || []).find((l) => l.profile_id === myProfileId) || null);

    const { data: setlistLinks } = await supabase
      .from('gig_setlists')
      .select('setlists(id, name, setlist_items(id, position, songs(id, title, artist, original_key, lyrics, reference_url)))')
      .eq('gig_id', gigId);

    const sets = (setlistLinks || [])
      .map((l) => l.setlists)
      .filter(Boolean)
      .map((sl) => ({
        ...sl,
        setlist_items: [...(sl.setlist_items || [])].sort((a, b) => a.position - b.position),
      }));
    setSetlists(sets);

    setLoading(false);
  }, [gigId, myProfileId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleConfirm() {
    if (!myEntry) return;
    setConfirming(true);
    const { error } = await supabase.from('gig_lineup').update({ confirmed: true }).eq('id', myEntry.id);
    setConfirming(false);
    if (error) {
      alert("Couldn't confirm: " + error.message);
      return;
    }
    load();
  }

  if (loading) return <p className="state-message">Loading gig details…</p>;
  if (error) return <p className="state-message state-message--error">Couldn't load gig: {error}</p>;
  if (!gig) return null;

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

  const myTravel = myEntry?.travel_cost_pence;

  return (
    <div className="day-sheet">
      <button className="link-button" onClick={onBack}>← Back to my gigs</button>

      {/* Confirmation banner */}
      {myEntry && (
        <div className={'day-sheet__confirm-banner day-sheet__confirm-banner--' + (myEntry.confirmed ? 'yes' : 'no')}>
          {myEntry.confirmed ? (
            <span>✓ You are confirmed for this gig as <strong>{myEntry.instruments?.name || 'musician'}</strong></span>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <span>You haven't confirmed this gig yet.</span>
              <button
                className="btn btn--primary btn--small"
                onClick={handleConfirm}
                disabled={confirming}
              >
                {confirming ? 'Confirming…' : 'Confirm I\'m available'}
              </button>
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
        {hasPin && (
          <iframe
            title="Venue map"
            width="100%"
            height="200"
            style={{ border: 0, borderRadius: 10, marginTop: 10 }}
            loading="lazy"
            src={mapSrc}
          />
        )}
        {directionsHref && (
          <button
            type="button"
            className="btn btn--primary btn--small"
            style={{ marginTop: 10 }}
            onClick={() => window.open(directionsHref, '_blank', 'noopener,noreferrer')}
          >
            Get directions
          </button>
        )}
      </div>

      {/* Notes */}
      {gig.notes && (
        <div className="day-sheet__section">
          <h3 className="day-sheet__section-title">Notes</h3>
          <p className="day-sheet__text">{gig.notes}</p>
        </div>
      )}

      {/* Roster */}
      <div className="day-sheet__section">
        <h3 className="day-sheet__section-title">Who's on this gig</h3>
        <ul className="day-sheet__roster">
          {lineup.map((l) => (
            <li key={l.id} className="day-sheet__roster-row">
              <div>
                <span className="day-sheet__roster-name">{l.profiles?.full_name}</span>
                {l.instruments?.name && (
                  <span className="day-sheet__roster-instrument">{l.instruments.name}</span>
                )}
              </div>
              <span className={'status-tag status-tag--' + (l.confirmed ? 'confirmed' : 'inquiry')}>
                {l.confirmed ? 'Confirmed' : 'Pending'}
              </span>
            </li>
          ))}
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
                          {song?.artist && <span className="day-sheet__song-artist"> — {song.artist}</span>}
                          {song?.original_key && (
                            <span className="setlist-song__key">{song.original_key}</span>
                          )}
                        </span>
                        <div className="day-sheet__song-actions">
                          {song?.reference_url && (
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
                      {isShowingPlayer && song?.reference_url && (
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

      {/* Musician's own payment claim */}
      <MusicianClaim gigId={gigId} myProfileId={myProfileId} />
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
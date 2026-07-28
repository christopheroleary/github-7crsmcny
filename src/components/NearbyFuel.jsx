import { useEffect, useState } from 'react';
import { fetchNearbyFuel } from '../utils/nearbyFuel.js';
import { parseOpeningHours } from '../utils/overpassPlaces.js';

function statusText(openingHours) {
  const hours = parseOpeningHours(openingHours);
  if (!hours.supported) return hours.raw ? 'Hours: ' + hours.raw : null;
  if (hours.always) return 'Open 24 hours';
  if (hours.isOpen) return 'Open now · closes ' + hours.closesAt;
  return hours.opensAt ? 'Closed · opens ' + hours.opensAt + (hours.opensDayLabel ? ' ' + hours.opensDayLabel : '') : 'Closed now';
}

function FuelRow({ station }) {
  const { name, lat, lon, distanceKm, minutes, openingHours, isAlwaysOpen } = station;
  const miles = (distanceKm * 0.621371).toFixed(1);
  const directionsHref = 'https://www.google.com/maps/dir/?api=1&destination=' + lat + ',' + lon + '&travelmode=driving';
  const hoursText = statusText(openingHours);

  return (
    <div className="day-sheet__roster-row">
      <div>
        <span className="day-sheet__roster-name">
          {name}
          {isAlwaysOpen && (
            <span className="status-tag" style={{ marginLeft: 6, background: 'var(--rust)22', color: 'var(--rust)', border: '1px solid var(--rust)44' }}>
              24/7
            </span>
          )}
        </span>
        <span className="day-sheet__roster-instrument">
          {miles} mi · ~{minutes} min drive{hoursText ? ' · ' + hoursText : ''}
        </span>
      </div>
      <button
        type="button"
        className="btn btn--ghost btn--small"
        style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
        onClick={() => window.open(directionsHref, '_blank', 'noopener,noreferrer')}
      >
        Directions ↗
      </button>
    </div>
  );
}

export default function NearbyFuel({ lat, lon, isOffline }) {
  const [state, setState] = useState({ loading: true, error: null, stations: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (lat == null || lon == null || isOffline) return;
    const controller = new AbortController();
    setState({ loading: true, error: null, stations: null });
    // Staggered so this doesn't fire at the exact same instant as the nearby-food query —
    // both hit the same rate-limited free Overpass servers, and running back-to-back instead
    // of simultaneously noticeably cuts how often they both get throttled.
    const startTimer = setTimeout(() => {
      fetchNearbyFuel(lat, lon, { signal: controller.signal })
        .then((stations) => setState({ loading: false, error: null, stations }))
        .catch(() => {
          if (controller.signal.aborted) return;
          setState({ loading: false, error: "Couldn't load nearby fuel options right now — the map data service may be busy.", stations: null });
        });
    }, 2000);
    return () => {
      clearTimeout(startTimer);
      controller.abort();
    };
  }, [lat, lon, isOffline, attempt]);

  if (lat == null || lon == null) return null;

  return (
    <div className="day-sheet__section">
      <h3 className="day-sheet__section-title">Nearby fuel</h3>
      {isOffline && <p className="field__hint">Connect to see nearby fuel options.</p>}
      {!isOffline && state.loading && <p className="state-message">Checking nearby options…</p>}
      {!isOffline && state.error && (
        <div>
          <p className="state-message state-message--error" style={{ padding: 0 }}>{state.error}</p>
          <button type="button" className="btn btn--ghost btn--small" style={{ marginTop: 8 }} onClick={() => setAttempt((a) => a + 1)}>
            Try again
          </button>
        </div>
      )}
      {!isOffline && state.stations && state.stations.length === 0 && (
        <p className="day-sheet__text day-sheet__text--muted">No fuel stations available within 20 minutes.</p>
      )}
      {!isOffline && state.stations && state.stations.length > 0 && (
        <div className="day-sheet__roster">
          {state.stations.map((station) => (
            <FuelRow key={station.lat + ',' + station.lon} station={station} />
          ))}
        </div>
      )}
    </div>
  );
}

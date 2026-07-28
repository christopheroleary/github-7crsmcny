import { useEffect, useState } from 'react';
import { FOOD_BRANDS, fetchNearbyFood, parseOpeningHours } from '../utils/nearbyFood.js';

function statusText(openingHours) {
  const hours = parseOpeningHours(openingHours);
  if (!hours.supported) return hours.raw ? 'Hours: ' + hours.raw : null;
  if (hours.always) return 'Open 24 hours';
  if (hours.isOpen) return 'Open now · closes ' + hours.closesAt;
  return hours.opensAt ? 'Closed · opens ' + hours.opensAt + (hours.opensDayLabel ? ' ' + hours.opensDayLabel : '') : 'Closed now';
}

function BrandRow({ brand, result }) {
  if (!result) {
    return (
      <div className="day-sheet__roster-row">
        <span className="day-sheet__text day-sheet__text--muted">{brand.label}: none available within 20 minutes</span>
      </div>
    );
  }
  const { lat, lon, distanceKm, minutes, openingHours } = result;
  const miles = (distanceKm * 0.621371).toFixed(1);
  const directionsHref = 'https://www.google.com/maps/dir/?api=1&destination=' + lat + ',' + lon + '&travelmode=driving';
  const hoursText = statusText(openingHours);

  return (
    <div className="day-sheet__roster-row">
      <div>
        <span className="day-sheet__roster-name">{brand.label}</span>
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

export default function NearbyFood({ lat, lon, isOffline }) {
  const [state, setState] = useState({ loading: true, error: null, results: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (lat == null || lon == null || isOffline) return;
    const controller = new AbortController();
    setState({ loading: true, error: null, results: null });
    fetchNearbyFood(lat, lon, { signal: controller.signal })
      .then((results) => setState({ loading: false, error: null, results }))
      .catch(() => {
        // Only a real cancellation (unmount / retry / venue change) aborts this effect's own
        // controller — an internal per-attempt timeout also throws AbortError but should surface.
        if (controller.signal.aborted) return;
        setState({ loading: false, error: "Couldn't load nearby food options right now — the map data service may be busy.", results: null });
      });
    return () => controller.abort();
  }, [lat, lon, isOffline, attempt]);

  if (lat == null || lon == null) return null;

  return (
    <div className="day-sheet__section">
      <h3 className="day-sheet__section-title">Nearby food</h3>
      {isOffline && <p className="field__hint">Connect to see nearby food options.</p>}
      {!isOffline && state.loading && <p className="state-message">Checking nearby options…</p>}
      {!isOffline && state.error && (
        <div>
          <p className="state-message state-message--error" style={{ padding: 0 }}>{state.error}</p>
          <button type="button" className="btn btn--ghost btn--small" style={{ marginTop: 8 }} onClick={() => setAttempt((a) => a + 1)}>
            Try again
          </button>
        </div>
      )}
      {!isOffline && state.results && (
        <div className="day-sheet__roster">
          {FOOD_BRANDS.map((brand) => (
            <BrandRow key={brand.key} brand={brand} result={state.results[brand.key]} />
          ))}
        </div>
      )}
    </div>
  );
}

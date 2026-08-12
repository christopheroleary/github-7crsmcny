import { FOOD_BRANDS, fetchNearbyFood } from '../utils/nearbyFood.js';
import { parseOpeningHours } from '../utils/overpassPlaces.js';
import NearbySection from './NearbySection.jsx';

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

export default function NearbyFood({ lat, lon, isOffline, bare, warmDelayMs }) {
  return (
    <NearbySection
      title="Food"
      lat={lat}
      lon={lon}
      isOffline={isOffline}
      fetchFn={fetchNearbyFood}
      bare={bare}
      cacheKey="food"
      warmDelayMs={warmDelayMs}
    >
      {(results) => (
        <div className="day-sheet__roster">
          {FOOD_BRANDS.map((brand) => (
            <BrandRow key={brand.key} brand={brand} result={results[brand.key]} />
          ))}
        </div>
      )}
    </NearbySection>
  );
}

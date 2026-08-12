import { HOTEL_BRANDS, fetchNearbyHotel } from '../utils/nearbyHotel.js';
import NearbySection from './NearbySection.jsx';

function BrandRow({ brand, result }) {
  if (!result) {
    return (
      <div className="day-sheet__roster-row">
        <span className="day-sheet__text day-sheet__text--muted">{brand.label}: none available within 20 minutes</span>
      </div>
    );
  }
  const { lat, lon, distanceKm, minutes } = result;
  const miles = (distanceKm * 0.621371).toFixed(1);
  const directionsHref = 'https://www.google.com/maps/dir/?api=1&destination=' + lat + ',' + lon + '&travelmode=driving';

  return (
    <div className="day-sheet__roster-row">
      <div>
        <span className="day-sheet__roster-name">{brand.label}</span>
        <span className="day-sheet__roster-instrument">{miles} mi · ~{minutes} min drive</span>
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

export default function NearbyHotel({ lat, lon, isOffline }) {
  return (
    <NearbySection title="Nearby hotels" lat={lat} lon={lon} isOffline={isOffline} fetchFn={fetchNearbyHotel}>
      {(results) => (
        <div className="day-sheet__roster">
          {HOTEL_BRANDS.map((brand) => (
            <BrandRow key={brand.key} brand={brand} result={results[brand.key]} />
          ))}
        </div>
      )}
    </NearbySection>
  );
}

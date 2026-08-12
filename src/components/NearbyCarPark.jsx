import { fetchNearbyCarPark } from '../utils/nearbyCarPark.js';
import { parseOpeningHours } from '../utils/overpassPlaces.js';
import NearbySection from './NearbySection.jsx';

function statusText(openingHours) {
  const hours = parseOpeningHours(openingHours);
  if (!hours.supported) return hours.raw ? 'Hours: ' + hours.raw : null;
  if (hours.always) return 'Open 24 hours';
  if (hours.isOpen) return 'Open now · closes ' + hours.closesAt;
  return hours.opensAt ? 'Closed · opens ' + hours.opensAt + (hours.opensDayLabel ? ' ' + hours.opensDayLabel : '') : 'Closed now';
}

function CarParkRow({ carPark }) {
  const { name, lat, lon, distanceKm, minutes, openingHours, isAlwaysOpen, fee, capacity } = carPark;
  const miles = (distanceKm * 0.621371).toFixed(1);
  const directionsHref = 'https://www.google.com/maps/dir/?api=1&destination=' + lat + ',' + lon + '&travelmode=driving';
  const hoursText = statusText(openingHours);
  const detailBits = [
    miles + ' mi',
    '~' + minutes + ' min drive',
    hoursText,
    fee,
    capacity ? capacity + ' spaces' : null,
  ].filter(Boolean);

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
        <span className="day-sheet__roster-instrument">{detailBits.join(' · ')}</span>
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

export default function NearbyCarPark({ lat, lon, isOffline, bare }) {
  return (
    <NearbySection title="Car parks" lat={lat} lon={lon} isOffline={isOffline} fetchFn={fetchNearbyCarPark} bare={bare}>
      {(carParks) =>
        carParks.length === 0 ? (
          <p className="day-sheet__text day-sheet__text--muted">No car parks available within 20 minutes.</p>
        ) : (
          <div className="day-sheet__roster">
            {carParks.map((carPark) => (
              <CarParkRow key={carPark.lat + ',' + carPark.lon} carPark={carPark} />
            ))}
          </div>
        )
      }
    </NearbySection>
  );
}

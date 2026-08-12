import { fetchNearbyMusicShop } from '../utils/nearbyMusicShop.js';
import { parseOpeningHours } from '../utils/overpassPlaces.js';
import NearbySection from './NearbySection.jsx';

function statusText(openingHours) {
  const hours = parseOpeningHours(openingHours);
  if (!hours.supported) return hours.raw ? 'Hours: ' + hours.raw : null;
  if (hours.always) return 'Open 24 hours';
  if (hours.isOpen) return 'Open now · closes ' + hours.closesAt;
  return hours.opensAt ? 'Closed · opens ' + hours.opensAt + (hours.opensDayLabel ? ' ' + hours.opensDayLabel : '') : 'Closed now';
}

function ShopRow({ shop }) {
  const { name, lat, lon, distanceKm, minutes, openingHours } = shop;
  const miles = (distanceKm * 0.621371).toFixed(1);
  const directionsHref = 'https://www.google.com/maps/dir/?api=1&destination=' + lat + ',' + lon + '&travelmode=driving';
  const hoursText = statusText(openingHours);

  return (
    <div className="day-sheet__roster-row">
      <div>
        <span className="day-sheet__roster-name">{name}</span>
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

export default function NearbyMusicShop({ lat, lon, isOffline }) {
  return (
    <NearbySection title="Nearby music shops" lat={lat} lon={lon} isOffline={isOffline} fetchFn={fetchNearbyMusicShop}>
      {(shops) =>
        shops.length === 0 ? (
          <p className="day-sheet__text day-sheet__text--muted">No music instrument shops available within 20 minutes.</p>
        ) : (
          <div className="day-sheet__roster">
            {shops.map((shop) => (
              <ShopRow key={shop.lat + ',' + shop.lon} shop={shop} />
            ))}
          </div>
        )
      }
    </NearbySection>
  );
}

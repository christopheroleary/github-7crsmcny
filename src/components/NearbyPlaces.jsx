import NearbyFood from './NearbyFood.jsx';
import NearbyFuel from './NearbyFuel.jsx';
import NearbyHotel from './NearbyHotel.jsx';
import NearbyMusicShop from './NearbyMusicShop.jsx';
import NearbyCarPark from './NearbyCarPark.jsx';

// One card grouping every "Nearby X" section instead of five separate ones
// stacked down the page -- each keeps its own fold-out (nothing forces it
// open), but this outer disclosure defaults open so landing here still
// shows what's available at a glance rather than hiding the whole feature
// behind an extra click.
//
// A venue with no cached data yet (see nearbyCache.js) quietly warms in the
// background rather than requiring the row to be opened -- but not all five
// at once, which is the exact concurrent-request pile-up that used to time
// out. Staggering the delay per category means the shared Overpass queue
// (overpassPlaces.js) sees them arrive spread out, and it's a few seconds
// before any of them fire at all so the gig page's own data isn't competing
// with this on load.
const WARM_DELAYS_MS = [3000, 5000, 7000, 9000, 11000];

export default function NearbyPlaces({ lat, lon, isOffline, venueName }) {
  if (lat == null || lon == null) return null;

  return (
    <div className="day-sheet__section">
      <details open>
        <summary className="day-sheet__section-title" style={{ cursor: 'pointer', userSelect: 'none' }}>
          Key places near {venueName || 'the venue'}
        </summary>
        <div
          style={{
            marginTop: 10,
            paddingLeft: 16,
            borderLeft: '2px solid var(--line)',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          <NearbyFood lat={lat} lon={lon} isOffline={isOffline} bare warmDelayMs={WARM_DELAYS_MS[0]} />
          <NearbyFuel lat={lat} lon={lon} isOffline={isOffline} bare warmDelayMs={WARM_DELAYS_MS[1]} />
          <NearbyHotel lat={lat} lon={lon} isOffline={isOffline} bare warmDelayMs={WARM_DELAYS_MS[2]} />
          <NearbyMusicShop lat={lat} lon={lon} isOffline={isOffline} bare warmDelayMs={WARM_DELAYS_MS[3]} />
          <NearbyCarPark lat={lat} lon={lon} isOffline={isOffline} bare warmDelayMs={WARM_DELAYS_MS[4]} />
        </div>
      </details>
    </div>
  );
}

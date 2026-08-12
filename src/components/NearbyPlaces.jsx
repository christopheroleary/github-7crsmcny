import NearbyFood from './NearbyFood.jsx';
import NearbyFuel from './NearbyFuel.jsx';
import NearbyHotel from './NearbyHotel.jsx';
import NearbyMusicShop from './NearbyMusicShop.jsx';
import NearbyCarPark from './NearbyCarPark.jsx';

// One card grouping every "Nearby X" section instead of five separate ones
// stacked down the page -- each keeps its own fold-out (still nothing
// fetches until that specific row is opened, see NearbySection.jsx), but
// this outer disclosure defaults open so landing here still shows what's
// available at a glance rather than hiding the whole feature behind an
// extra click.
export default function NearbyPlaces({ lat, lon, isOffline, venueName }) {
  if (lat == null || lon == null) return null;

  return (
    <div className="day-sheet__section">
      <details open>
        <summary className="day-sheet__section-title" style={{ cursor: 'pointer', userSelect: 'none' }}>
          Key places near {venueName || 'the venue'}
        </summary>
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <NearbyFood lat={lat} lon={lon} isOffline={isOffline} bare />
          <NearbyFuel lat={lat} lon={lon} isOffline={isOffline} bare />
          <NearbyHotel lat={lat} lon={lon} isOffline={isOffline} bare />
          <NearbyMusicShop lat={lat} lon={lon} isOffline={isOffline} bare />
          <NearbyCarPark lat={lat} lon={lon} isOffline={isOffline} bare />
        </div>
      </details>
    </div>
  );
}

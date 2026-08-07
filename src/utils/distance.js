const METERS_PER_MILE = 1609.344;

// Real driving distance (not haversine) via the public OSRM router --
// shared by TravelCalculator (musician travel costs) and DepFinderWizard
// (ranking dep candidates by how far they'd have to drive).
export async function fetchDrivingMiles(fromLat, fromLon, toLat, toLon) {
  const url =
    'https://router.project-osrm.org/route/v1/driving/' +
    fromLon + ',' + fromLat + ';' + toLon + ',' + toLat +
    '?overview=false';
  const res = await fetch(url);
  const data = await res.json();
  if (data.code !== 'Ok' || !data.routes?.[0]) return null;
  return data.routes[0].distance / METERS_PER_MILE;
}

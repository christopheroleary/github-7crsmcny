import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { notify } from '../utils/toastService.js';
import { fetchDrivingMiles } from '../utils/distance.js';

export default function TravelCalculator({ gigId, venueLat, venueLon, mileageRatePence }) {
  const [lineup, setLineup] = useState([]);
  const [calculating, setCalculating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const rate = mileageRatePence ?? 35;

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('gig_lineup')
      .select('id, travel_miles, travel_cost_pence, lift_share, profiles(full_name, home_latitude, home_longitude, home_address), placeholder_musicians(name, latitude, longitude, address)')
      .eq('gig_id', gigId);
    setLineup(data || []);
    setLoading(false);
  }, [gigId]);

  // A lineup entry's home location comes from whichever side is set —
  // a full member's profile, or a dep's own saved address.
  function homeOf(entry) {
    if (entry.profiles) {
      return { name: entry.profiles.full_name, lat: entry.profiles.home_latitude, lon: entry.profiles.home_longitude, address: entry.profiles.home_address };
    }
    if (entry.placeholder_musicians) {
      return { name: entry.placeholder_musicians.name, lat: entry.placeholder_musicians.latitude, lon: entry.placeholder_musicians.longitude, address: entry.placeholder_musicians.address };
    }
    return { name: null, lat: null, lon: null, address: null };
  }

  useEffect(() => {
    load();
  }, [load]);

  async function calculateAll() {
    if (!venueLat || !venueLon) {
      setError("The venue needs a map pin before travel can be calculated. Edit the venue and re-pick its address from the suggestion list.");
      return;
    }

    const needsCalc = lineup.filter((l) => {
      const home = homeOf(l);
      return !l.lift_share && home.lat != null && home.lon != null;
    });

    if (needsCalc.length === 0) {
      setError("No booked musicians have a home address with a map pin set yet. Each musician (or dep) needs one saved.");
      return;
    }

    setCalculating(true);
    setError(null);

    // Written values (miles/cost) are computed here, client-side, before
    // each write -- so once a write succeeds, applying that same value to
    // local state directly is exactly as correct as re-fetching gig_lineup
    // to learn it back, without the extra round trip.
    const updates = new Map();

    for (const entry of needsCalc) {
      const home = homeOf(entry);
      try {
        const miles = await fetchDrivingMiles(home.lat, home.lon, venueLat, venueLon);
        if (miles == null) continue;
        const roundTrip = miles * 2;
        const costPence = Math.round(roundTrip * rate);
        const travelMiles = Math.round(roundTrip * 10) / 10;
        const { error } = await supabase
          .from('gig_lineup')
          .update({ travel_miles: travelMiles, travel_cost_pence: costPence })
          .eq('id', entry.id);
        if (error) {
          notify("Couldn't save travel cost for " + (entry.profiles?.full_name || entry.placeholder_musicians?.name || 'a musician') + ": " + error.message);
        } else {
          updates.set(entry.id, { travel_miles: travelMiles, travel_cost_pence: costPence });
        }
      } catch {
        // silently skip if routing fails for one musician
      }
    }

    setLineup((prev) => prev.map((l) => (updates.has(l.id) ? { ...l, ...updates.get(l.id) } : l)));
    setCalculating(false);
  }

  async function toggleLiftShare(entry) {
    const nextLiftShare = !entry.lift_share;
    // Toggling ON zeroes travel_cost_pence (matches the write below); toggling
    // OFF leaves whatever cost was last calculated untouched, same as the
    // write, which doesn't include travel_cost_pence in that case at all.
    const patch = nextLiftShare ? { lift_share: true, travel_cost_pence: 0 } : { lift_share: false };
    const { error } = await supabase
      .from('gig_lineup')
      .update(patch)
      .eq('id', entry.id);
    if (error) { notify("Couldn't update lift share: " + error.message); return; }
    setLineup((prev) => prev.map((l) => (l.id === entry.id ? { ...l, ...patch } : l)));
  }

  const totalTravelPence = lineup.reduce((sum, l) => sum + (l.travel_cost_pence || 0), 0);
  const hasAnyMissing = lineup.some((l) => homeOf(l).lat == null);

  if (loading) return <p className="state-message">Loading travel costs…</p>;
  if (lineup.length === 0) return null;

  return (
    <div className="roster-section">
      <h3 className="roster-section__title">Travel costs</h3>

      {error && <p className="form-error">{error}</p>}

      <div style={{ overflowX: 'auto' }}>
      <table className="travel-table">
        <thead>
          <tr>
            <th>Musician</th>
            <th>Round trip</th>
            <th>Cost @ {rate}p/mile</th>
            <th>Fuel</th>
          </tr>
        </thead>
        <tbody>
          {lineup.map((entry) => {
            const home = homeOf(entry);
            const noPin = home.lat == null;
            return (
              <tr key={entry.id}>
                <td>{home.name ?? '—'}</td>
                <td>
                  {noPin
                    ? <span className="field__hint">No home address set</span>
                    : entry.travel_miles != null
                    ? entry.travel_miles + ' miles'
                    : <span className="field__hint">Not calculated yet</span>}
                </td>
                <td>
                  {entry.lift_share
                    ? <span className="field__hint">Lift share</span>
                    : entry.travel_cost_pence != null
                    ? '£' + (entry.travel_cost_pence / 100).toFixed(2)
                    : '—'}
                </td>
                <td>
                  <button type="button" className="link-button" onClick={() => toggleLiftShare(entry)}>
                    {entry.lift_share ? 'Charging fuel' : 'Lift share (no fuel)'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
        {totalTravelPence > 0 && (
          <tfoot>
            <tr>
              <td colSpan={3}><strong>Total travel</strong></td>
              <td><strong>£{(totalTravelPence / 100).toFixed(2)}</strong></td>
            </tr>
          </tfoot>
        )}
      </table>
      </div>

      {hasAnyMissing && (
        <p className="field__hint" style={{ marginTop: 6 }}>
          Musicians or deps without a home address set (on their profile, or under Musicians for a dep) are excluded from the calculation.
        </p>
      )}

      <div style={{ marginTop: 12 }}>
        <button type="button" className="btn btn--primary btn--small" onClick={calculateAll} disabled={calculating}>
          {calculating ? 'Calculating…' : 'Recalculate travel costs'}
        </button>
      </div>
    </div>
  );
}
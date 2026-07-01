import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';

const METERS_PER_MILE = 1609.344;

async function fetchDrivingMiles(fromLat, fromLon, toLat, toLon) {
  const url =
    'https://router.project-osrm.org/route/v1/driving/' +
    fromLon + ',' + fromLat + ';' + toLon + ',' + toLat +
    '?overview=false';
  const res = await fetch(url);
  const data = await res.json();
  if (data.code !== 'Ok' || !data.routes?.[0]) return null;
  return data.routes[0].distance / METERS_PER_MILE;
}

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
      .select('id, travel_miles, travel_cost_pence, profiles(full_name, home_latitude, home_longitude, home_address)')
      .eq('gig_id', gigId);
    setLineup(data || []);
    setLoading(false);
  }, [gigId]);

  useEffect(() => {
    load();
  }, [load]);

  async function calculateAll() {
    if (!venueLat || !venueLon) {
      setError("The venue needs a map pin before travel can be calculated. Edit the venue and re-pick its address from the suggestion list.");
      return;
    }

    const needsCalc = lineup.filter((l) => {
      const p = l.profiles;
      return p?.home_latitude != null && p?.home_longitude != null;
    });

    if (needsCalc.length === 0) {
      setError("No booked musicians have a home address with a map pin set yet. Each musician needs to set this on their own profile.");
      return;
    }

    setCalculating(true);
    setError(null);

    for (const entry of needsCalc) {
      const p = entry.profiles;
      try {
        const miles = await fetchDrivingMiles(p.home_latitude, p.home_longitude, venueLat, venueLon);
        if (miles == null) continue;
        const roundTrip = miles * 2;
        const costPence = Math.round(roundTrip * rate);
        await supabase
          .from('gig_lineup')
          .update({ travel_miles: Math.round(roundTrip * 10) / 10, travel_cost_pence: costPence })
          .eq('id', entry.id);
      } catch {
        // silently skip if routing fails for one musician
      }
    }

    setCalculating(false);
    load();
  }

  const totalTravelPence = lineup.reduce((sum, l) => sum + (l.travel_cost_pence || 0), 0);
  const hasAnyMissing = lineup.some((l) => !l.profiles?.home_latitude);

  if (loading) return <p className="state-message">Loading travel costs…</p>;
  if (lineup.length === 0) return null;

  return (
    <div className="roster-section">
      <h3 className="roster-section__title">Travel costs</h3>

      {error && <p className="form-error">{error}</p>}

      <table className="travel-table">
        <thead>
          <tr>
            <th>Musician</th>
            <th>Round trip</th>
            <th>Cost @ {rate}p/mile</th>
          </tr>
        </thead>
        <tbody>
          {lineup.map((entry) => {
            const p = entry.profiles;
            const noPin = !p?.home_latitude;
            return (
              <tr key={entry.id}>
                <td>{p?.full_name ?? '—'}</td>
                <td>
                  {noPin
                    ? <span className="field__hint">No home address set</span>
                    : entry.travel_miles != null
                    ? entry.travel_miles + ' miles'
                    : <span className="field__hint">Not calculated yet</span>}
                </td>
                <td>
                  {entry.travel_cost_pence != null
                    ? '£' + (entry.travel_cost_pence / 100).toFixed(2)
                    : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
        {totalTravelPence > 0 && (
          <tfoot>
            <tr>
              <td colSpan={2}><strong>Total travel</strong></td>
              <td><strong>£{(totalTravelPence / 100).toFixed(2)}</strong></td>
            </tr>
          </tfoot>
        )}
      </table>

      {hasAnyMissing && (
        <p className="field__hint" style={{ marginTop: 6 }}>
          Musicians without a home address set on their profile are excluded from the calculation.
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
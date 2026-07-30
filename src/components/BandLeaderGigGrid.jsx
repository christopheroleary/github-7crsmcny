import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useCurrentProfile } from '../context/ProfileContext.jsx';
import { formatCompactDate, formatMonthYear, todayStr } from '../utils/formatDate.js';
import { parseTownFromAddress } from '../utils/parseAddress.js';

// Which role group an instrument's cells belong to. Anything not listed here
// (Saxophone, Backing Vocals, etc.) is out of scope for this grid.
const INSTRUMENT_TO_GROUP = {
  Drums: 'drummer',
  'Bass Guitar': 'bass',
  'Electric Guitar': 'guitarKeys',
  'Acoustic Guitar': 'guitarKeys',
  Keys: 'guitarKeys',
  'Lead Vocals': 'singer',
};

const GROUPS = [
  { key: 'drummer', label: 'Drummer' },
  { key: 'bass', label: 'Bass' },
  { key: 'guitarKeys', label: 'Guitar/Keys' },
  { key: 'singer', label: 'Singer' },
  { key: 'dj', label: 'DJ' },
  { key: 'roadie', label: 'Roadie' },
];

function initialsFor(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatTime(t) {
  return t ? t.slice(0, 5) : '';
}

export default function BandLeaderGigGrid() {
  const { ledBandIds } = useCurrentProfile();
  const [rows, setRows] = useState([]);
  const [maxCols, setMaxCols] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!ledBandIds || ledBandIds.length === 0) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    const { data: gigs, error: gigsError } = await supabase
      .from('gigs')
      .select('id, band_id, gig_date, load_in_time, start_time, end_time, needs_dj, needs_roadie, venues(address), bands(name)')
      .in('band_id', ledBandIds)
      .gte('gig_date', todayStr())
      .neq('status', 'cancelled')
      .order('gig_date', { ascending: true })
      .order('band_id', { ascending: true });

    if (gigsError) {
      setError(gigsError.message);
      setLoading(false);
      return;
    }

    const gigIds = (gigs || []).map((g) => g.id);
    if (gigIds.length === 0) {
      setRows([]);
      setLoading(false);
      return;
    }

    const [{ data: lineupRows }, { data: reqRows }] = await Promise.all([
      supabase
        .from('gig_lineup')
        .select('gig_id, is_captain, is_dj, is_roadie, profiles(full_name), placeholder_musicians(name), instruments(name)')
        .in('gig_id', gigIds),
      supabase
        .from('gig_requirements')
        .select('gig_id, quantity, instruments(name)')
        .in('gig_id', gigIds),
    ]);

    // ── Build per-gig role-group arrays + required counts ──────────────────
    const running = { drummer: 1, bass: 1, guitarKeys: 1, singer: 1, dj: 1, roadie: 1 };

    const gigMap = {};
    for (const g of gigs) {
      gigMap[g.id] = {
        ...g,
        town: parseTownFromAddress(g.venues?.address),
        bandName: g.bands?.name || '',
        arrival: g.load_in_time || g.start_time,
        finish: g.end_time,
        people: { drummer: [], bass: [], guitarKeys: [], singer: [], dj: [], roadie: [] },
        required: { drummer: 0, bass: 0, guitarKeys: 0, singer: 0, dj: g.needs_dj ? 1 : 0, roadie: g.needs_roadie ? 1 : 0 },
      };
    }

    for (const row of lineupRows || []) {
      const gig = gigMap[row.gig_id];
      if (!gig) continue;
      const name = row.profiles?.full_name || row.placeholder_musicians?.name || '';
      const entry = { initials: initialsFor(name), isCaptain: !!row.is_captain, sortKey: name };

      const instrumentGroup = INSTRUMENT_TO_GROUP[row.instruments?.name];
      if (instrumentGroup) gig.people[instrumentGroup].push(entry);
      if (row.is_dj) gig.people.dj.push(entry);
      if (row.is_roadie) gig.people.roadie.push(entry);
    }

    for (const row of reqRows || []) {
      const gig = gigMap[row.gig_id];
      if (!gig) continue;
      const group = INSTRUMENT_TO_GROUP[row.instruments?.name];
      if (group) gig.required[group] += row.quantity || 0;
    }

    for (const gig of Object.values(gigMap)) {
      for (const key of Object.keys(running)) {
        gig.people[key].sort((a, b) => a.sortKey.localeCompare(b.sortKey));
        running[key] = Math.max(running[key], gig.people[key].length, gig.required[key]);
      }
    }

    // ── Group consecutive rows sharing date + band for the merged date cell ─
    const grouped = [];
    for (const g of gigs) {
      const gig = gigMap[g.id];
      const last = grouped[grouped.length - 1];
      if (last && last[0].gig_date === gig.gig_date && last[0].band_id === gig.band_id) {
        last.push(gig);
      } else {
        grouped.push([gig]);
      }
    }

    setRows(grouped);
    setMaxCols(running);
    setLoading(false);
  }, [ledBandIds]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <p className="state-message">Loading gig grid…</p>;
  if (error) return <p className="state-message state-message--error">Couldn't load: {error}</p>;
  if (!ledBandIds || ledBandIds.length === 0) {
    return <p className="state-message">You're not assigned to lead any bands yet.</p>;
  }
  if (rows.length === 0) {
    return <p className="state-message">No upcoming gigs.</p>;
  }

  const totalCols = 4 + GROUPS.reduce((sum, g) => sum + (maxCols[g.key] || 1), 0);

  let prevMonth = null;

  return (
    <div className="gig-grid">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Town</th>
            <th>Arrival</th>
            <th>Finish</th>
            {GROUPS.map((g) => (
              <th key={g.key} colSpan={maxCols[g.key] || 1}>{g.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((group, groupIdx) => {
            const firstGig = group[0];
            const monthKey = firstGig.gig_date.slice(0, 7);
            const showMonthRow = monthKey !== prevMonth;
            prevMonth = monthKey;

            return (
              <GigGroupRows
                key={groupIdx}
                group={group}
                showMonthRow={showMonthRow}
                monthLabel={formatMonthYear(firstGig.gig_date)}
                totalCols={totalCols}
                maxCols={maxCols}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function GigGroupRows({ group, showMonthRow, monthLabel, totalCols, maxCols }) {
  return (
    <>
      {showMonthRow && (
        <tr className="gig-grid__month-row">
          <td colSpan={totalCols}>{monthLabel}</td>
        </tr>
      )}
      {group.map((gig, idx) => (
        <tr key={gig.id}>
          {idx === 0 && (
            <td rowSpan={group.length} className="gig-grid__date">
              {formatCompactDate(gig.gig_date)}
            </td>
          )}
          <td>{gig.town || '—'}</td>
          <td>{formatTime(gig.arrival)}</td>
          <td>{formatTime(gig.finish)}</td>
          {GROUPS.map((g) => {
            const cols = maxCols[g.key] || 1;
            const people = gig.people[g.key];
            const required = gig.required[g.key];
            const cells = [];
            for (let i = 0; i < cols; i++) {
              const person = people[i];
              if (person) {
                cells.push(
                  <td key={i} className={'gig-grid__cell' + (person.isCaptain ? ' gig-grid__cell--captain' : '')}>
                    {person.initials}
                  </td>
                );
              } else if (i < required) {
                cells.push(
                  <td key={i} className="gig-grid__cell gig-grid__cell--missing">?</td>
                );
              } else {
                cells.push(<td key={i} className="gig-grid__cell gig-grid__cell--empty" />);
              }
            }
            return cells;
          })}
        </tr>
      ))}
    </>
  );
}

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { formatCompactDate, formatMonthYear, todayStr } from '../utils/formatDate.js';
import { parseTownFromAddress } from '../utils/parseAddress.js';
import { displayBandName } from '../utils/bandName.js';

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

// Short codes keep header cells narrow — full names are in the legend
// under the table instead. Guitar/Keys is split into two columns: Gtr
// gets the first (alphabetically) guitarist, Gt2/Key pools everyone
// else in that group — a second guitarist, a keys player, or both
// stacked if there happen to be more than two.
const GROUPS_LEFT = [
  { key: 'drummer', label: 'Drm', title: 'Drummer' },
  { key: 'bass', label: 'Bas', title: 'Bass' },
];
const GROUPS_RIGHT = [
  { key: 'singer', label: 'Vox', title: 'Singer' },
  { key: 'dj', label: 'DJ', title: 'DJ' },
  { key: 'roadie', label: 'Rd', title: 'Roadie' },
];

const BASE_TOTAL_COLS = 4 + GROUPS_LEFT.length + 2 + GROUPS_RIGHT.length;

function initialsFor(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Cells are a fixed pixel/percentage slice of the table (table-layout:
// fixed + width:100%), so text just needs the CSS ellipsis already on
// every cell -- not a hardcoded JS character cap that has no idea how
// wide the column actually ends up being at the viewport's current size.
function cellText(text) {
  return text || '—';
}

function formatTime(t) {
  return t ? t.slice(0, 5) : '';
}

// Everyone gets this grid (admin sees every band's gigs, a band leader
// sees gigs for the bands they lead plus any they personally perform on,
// a plain band member sees just their own gigs) — the `gigs` query below
// has no band_id filter at all, so RLS is the only thing scoping results
// per role. The Band column only appears when more than one band shows
// up in the current result set, so a single-band leader's view stays as
// compact as before.
export default function BandLeaderGigGrid() {
  const [rows, setRows] = useState([]);
  const [showBandColumn, setShowBandColumn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data: gigs, error: gigsError } = await supabase
      .from('gigs')
      .select('id, band_id, gig_date, load_in_time, start_time, end_time, needs_dj, needs_roadie, venues(address), bands(name)')
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
    const gigMap = {};
    for (const g of gigs) {
      gigMap[g.id] = {
        ...g,
        town: cellText(parseTownFromAddress(g.venues?.address)),
        bandName: cellText(displayBandName(g.bands?.name)),
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
      for (const key of Object.keys(gig.people)) {
        gig.people[key].sort((a, b) => a.sortKey.localeCompare(b.sortKey));
      }
      gig.people.guitar1 = gig.people.guitarKeys.slice(0, 1);
      gig.people.guitar2Keys = gig.people.guitarKeys.slice(1);
      gig.required.guitar1 = Math.min(1, gig.required.guitarKeys);
      gig.required.guitar2Keys = Math.max(0, gig.required.guitarKeys - 1);
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
    setShowBandColumn(new Set(gigs.map((g) => g.band_id)).size > 1);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <p className="state-message">Loading gig grid…</p>;
  if (error) return <p className="state-message state-message--error">Couldn't load: {error}</p>;
  if (rows.length === 0) {
    return <p className="state-message">No upcoming gigs.</p>;
  }

  const totalCols = BASE_TOTAL_COLS + (showBandColumn ? 1 : 0);
  let prevMonth = null;

  return (
    <div className="gig-grid">
      <table>
        <colgroup>
          <col className="gig-grid__col-date" />
          {showBandColumn && <col className="gig-grid__col-town" />}
          <col className="gig-grid__col-town" />
          <col className="gig-grid__col-time" />
          <col className="gig-grid__col-time" />
          {GROUPS_LEFT.map((g) => (
            <col key={g.key} className="gig-grid__col-role" />
          ))}
          <col className="gig-grid__col-role" />
          <col className="gig-grid__col-role" />
          {GROUPS_RIGHT.map((g) => (
            <col key={g.key} className="gig-grid__col-role" />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th>Date</th>
            {showBandColumn && <th>Band</th>}
            <th>Town</th>
            <th title="Arrival">Arr</th>
            <th title="Finish">Fin</th>
            {GROUPS_LEFT.map((g) => (
              <th key={g.key} title={g.title}>{g.label}</th>
            ))}
            <th title="Guitar 1">Gtr</th>
            <th title="Guitar 2 or Keys" className="gig-grid__th-split">
              <div>Gt2</div>
              <div>Key</div>
            </th>
            {GROUPS_RIGHT.map((g) => (
              <th key={g.key} title={g.title}>{g.label}</th>
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
                showBandColumn={showBandColumn}
                totalCols={totalCols}
              />
            );
          })}
        </tbody>
      </table>
      <p className="gig-grid__legend">
        Drm Drummer &nbsp;·&nbsp; Bas Bass &nbsp;·&nbsp; Gtr Guitar 1 &nbsp;·&nbsp; Gt2/Key Guitar 2 or Keys &nbsp;·&nbsp; Vox Singer &nbsp;·&nbsp; DJ DJ &nbsp;·&nbsp; Rd Roadie
      </p>
    </div>
  );
}

function GigGroupRows({ group, showMonthRow, monthLabel, showBandColumn, totalCols }) {
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
          {showBandColumn && <td>{gig.bandName}</td>}
          <td>{gig.town}</td>
          <td>{formatTime(gig.arrival)}</td>
          <td>{formatTime(gig.finish)}</td>
          {GROUPS_LEFT.map((g) => (
            <RoleCell key={g.key} people={gig.people[g.key]} required={gig.required[g.key]} />
          ))}
          <RoleCell people={gig.people.guitar1} required={gig.required.guitar1} />
          <RoleCell people={gig.people.guitar2Keys} required={gig.required.guitar2Keys} />
          {GROUPS_RIGHT.map((g) => (
            <RoleCell key={g.key} people={gig.people[g.key]} required={gig.required[g.key]} />
          ))}
        </tr>
      ))}
    </>
  );
}

function RoleCell({ people, required }) {
  const lineCount = Math.max(people.length, required);
  if (lineCount === 0) {
    return <td className="gig-grid__cell gig-grid__cell--empty" />;
  }
  return (
    <td className="gig-grid__cell">
      {Array.from({ length: lineCount }, (_, i) => {
        const person = people[i];
        if (person) {
          return (
            <div key={i} className={'gig-grid__line' + (person.isCaptain ? ' gig-grid__line--captain' : '')}>
              {person.initials}
            </div>
          );
        }
        return (
          <div key={i} className="gig-grid__line gig-grid__line--missing">?</div>
        );
      })}
    </td>
  );
}

import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { formatCompactDate, formatMonthYear, todayStr } from '../utils/formatDate.js';
import { parseTownFromAddress } from '../utils/parseAddress.js';
import { displayBandName } from '../utils/bandName.js';
import { isLikelyOfflineError } from '../utils/networkError.js';
import { useIsOffline } from '../hooks/useIsOffline.js';
import { readGigCache, getKnownCachedIds } from '../hooks/useOfflineGigList.js';

// Shown only when offline AND no per-gig cache exists yet for anything
// upcoming -- naming the working alternative is more useful than just
// "you're offline", and it's genuinely correct advice: List/Calendar's
// background precache (useOfflineGigList) is what populates the same
// per-gig cache entries this view now reads, so opening one of those while
// online is exactly what warms this view's data too.
const OFFLINE_MESSAGE = "You're offline and haven't loaded grid view's data before — open List or Calendar view while online first, which pre-caches everything this view needs too.";

// Which role group an instrument's cells belong to. Percussion shares the
// Drums column (see instrumentRank below, which keeps it sorted below the
// actual drummer rather than interleaved alphabetically) rather than
// getting a column of its own. Anything with a real instrument that isn't
// explicitly listed here -- Backing Vocals, Double Bass, Saxophone, or any
// instrument added later -- falls into the Gtr2/Key column by default (see
// groupFor below), so a gig requiring or booking an odd-one-out instrument
// still shows up somewhere instead of silently vanishing from the grid.
const INSTRUMENT_TO_GROUP = {
  Drums: 'drummer',
  Percussion: 'drummer',
  'Bass Guitar': 'bass',
  'Electric Guitar': 'guitarKeys',
  'Acoustic Guitar': 'guitarKeys',
  Keys: 'guitarKeys',
  Saxophone: 'guitarKeys',
  'Lead Vocals': 'singer',
};

// Shared by both the lineup pass (who's actually booked) and the
// requirements pass (how many are needed) below, so an unfilled slot for
// an unmapped instrument (e.g. "needs 1 Saxophone") still shows its "?" in
// the same column a booked player of that instrument would land in,
// instead of the two disagreeing about where it belongs.
function groupFor(instrumentName) {
  if (!instrumentName) return null;
  return INSTRUMENT_TO_GROUP[instrumentName] || 'guitarKeys';
}

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

// Relative weights, not literal pixel/percentage widths -- normalized to
// sum to exactly 100% at render time (see colWidthPercents below), which
// is what actually guarantees the table can never be wider than its
// container (the previous px-based widths could add up to MORE than
// 100% of the viewport at some screen sizes -- table-layout:fixed does
// NOT shrink columns to compensate when that happens, it just makes the
// whole table wider than intended, which is what forced the horizontal
// scrollbar). Date gets the most generous share relative to how little
// text it holds ("Sat 29"), since it's the one column that must never
// truncate.
const COL_WEIGHTS = {
  date: 14,
  band: 12,
  town: 16,
  arr: 9,
  req: 7,
  drummer: 9,
  bass: 9,
  guitar1: 9,
  guitar2Keys: 10,
  singer: 9,
  dj: 8,
  roadie: 8,
};

// Builds the ordered list of {key, widthPercent} for exactly the columns
// this render actually shows (band is conditional) -- excluding it from
// the weight sum here, not just from the output list, is what keeps the
// remaining columns' percentages correctly summing to 100 on their own
// rather than leaving a gap the width of band's share.
function colWidthPercents(showBandColumn) {
  const keys = ['date', ...(showBandColumn ? ['band'] : []), 'town', 'arr', 'req', 'drummer', 'bass', 'guitar1', 'guitar2Keys', 'singer', 'dj', 'roadie'];
  const totalWeight = keys.reduce((sum, k) => sum + COL_WEIGHTS[k], 0);
  return keys.map((key) => ({ key, widthPercent: (COL_WEIGHTS[key] / totalWeight) * 100 }));
}

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

// Pure: turns flat gigs/lineupRows/reqRows arrays into the grouped `rows`
// shape the table renders. Shared between the online path (a fresh bulk
// fetch) and the offline path (reassembled from per-gig caches) so both
// produce identical output from the same logic.
function buildRows(gigs, lineupRows, reqRows) {
  const gigMap = {};
  for (const g of gigs) {
    gigMap[g.id] = {
      ...g,
      town: cellText(parseTownFromAddress(g.venues?.address)),
      bandName: cellText(displayBandName(g.bands?.name)),
      arrival: g.load_in_time || g.start_time,
      people: { drummer: [], bass: [], guitarKeys: [], singer: [], dj: [], roadie: [] },
      required: { drummer: 0, bass: 0, guitarKeys: 0, singer: 0, dj: g.needs_dj ? 1 : 0, roadie: g.needs_roadie ? 1 : 0 },
    };
  }

  for (const row of lineupRows || []) {
    const gig = gigMap[row.gig_id];
    if (!gig) continue;
    const name = row.profiles?.full_name || row.placeholder_musicians?.name || '';
    // Stable per-person identity -- a profile or a dep/placeholder, never
    // both -- used below to spot the same human filling more than one role
    // on the same gig (e.g. guitar AND roadie) so the second (and any
    // further) appearance can be bracketed instead of just repeating their
    // initials as if they were a different person.
    const personKey = row.profile_id || row.placeholder_id;
    // A fresh object per role rather than one shared reference -- someone
    // covering two roles gets two independent entries (same personKey,
    // same initials), so "is this their first appearance on the row" can
    // be marked per-role below without one role's flag leaking into another.
    function makeEntry() {
      return {
        key: personKey,
        initials: initialsFor(name),
        isCaptain: !!row.is_captain,
        confirmed: !!row.confirmed,
        sortKey: name,
        instrumentName: row.instruments?.name || null,
        // Sorts a Drums-column percussionist below the actual drummer(s)
        // rather than interleaved alphabetically -- 0 for every other
        // instrument, so this has no effect on any other column's ordering.
        instrumentRank: row.instruments?.name === 'Percussion' ? 1 : 0,
      };
    }

    const instrumentGroup = groupFor(row.instruments?.name);
    if (instrumentGroup) gig.people[instrumentGroup].push(makeEntry());
    if (row.is_dj) gig.people.dj.push(makeEntry());
    if (row.is_roadie) gig.people.roadie.push(makeEntry());
  }

  for (const row of reqRows || []) {
    const gig = gigMap[row.gig_id];
    if (!gig) continue;
    const group = groupFor(row.instruments?.name);
    if (group) gig.required[group] += row.quantity || 0;
  }

  for (const gig of Object.values(gigMap)) {
    for (const key of Object.keys(gig.people)) {
      gig.people[key].sort((a, b) => (a.instrumentRank - b.instrumentRank) || a.sortKey.localeCompare(b.sortKey));
    }

    // Gtr should be an actual guitarist, not just whoever in the combined
    // guitar/keys/sax group sorts first alphabetically -- a keys player
    // named e.g. "Mike" outranking a guitarist named "Neil" was landing
    // the keys player in Gtr and bumping the guitarist into Gt2/Key. Pull
    // the first real guitarist (Electric or Acoustic) to the front, if
    // there is one, before slicing off the Gtr/Gt2/Key split; falls back
    // to the previous alphabetical-first behaviour when nobody in the
    // group is actually a guitarist (all keys/sax).
    const guitarists = gig.people.guitarKeys;
    const guitarIdx = guitarists.findIndex((e) => e.instrumentName === 'Electric Guitar' || e.instrumentName === 'Acoustic Guitar');
    if (guitarIdx > 0) {
      const [g] = guitarists.splice(guitarIdx, 1);
      guitarists.unshift(g);
    }
    gig.people.guitar1 = guitarists.slice(0, 1);
    gig.people.guitar2Keys = guitarists.slice(1);
    gig.required.guitar1 = Math.min(1, gig.required.guitarKeys);
    gig.required.guitar2Keys = Math.max(0, gig.required.guitarKeys - 1);

    // How many people the gig calls for in total, regardless of whether
    // one person ends up covering more than one of those slots -- a
    // planning figure (e.g. "client asked for a 5-piece"), not a live
    // filled-count (each column's own initials/"?" already shows that).
    gig.requiredTotal = gig.required.drummer + gig.required.bass + gig.required.guitarKeys
      + gig.required.singer + gig.required.dj + gig.required.roadie;

    // Second (and further) appearance of the same person across the row,
    // in left-to-right column order, gets bracketed -- matches ROW_ORDER
    // in the render below.
    const seen = new Set();
    for (const groupKey of ['drummer', 'bass', 'guitar1', 'guitar2Keys', 'singer', 'dj', 'roadie']) {
      for (const entry of gig.people[groupKey]) {
        if (entry.key != null) {
          entry.isRepeat = seen.has(entry.key);
          seen.add(entry.key);
        }
      }
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

  return { grouped, showBandColumn: new Set(gigs.map((g) => g.band_id)).size > 1 };
}

// Pure: reassembles rows from whatever per-gig caches exist -- the same
// gigcache:<id> entries List/Calendar's background precache
// (useOfflineGigList) already populates, widened to also carry what this
// view needs (is_captain/is_dj/is_roadie, gig_requirements). A gig with no
// cache entry at all (never opened/precached while online) is left out
// rather than shown as a broken row -- partial data offline, not
// all-or-nothing. No state here -- callable both from a lazy useState
// initializer (paint instantly from whatever's on the device, same as
// List/Calendar already do) and from load()'s own fallback path.
function buildFromCache() {
  const today = todayStr();
  const gigs = [];
  const lineupRows = [];
  const reqRows = [];
  for (const id of getKnownCachedIds()) {
    const cached = readGigCache(id);
    const g = cached?.gig;
    if (!g || g.gig_date < today || g.status === 'cancelled') continue;
    gigs.push(g);
    for (const l of cached.lineup || []) lineupRows.push({ ...l, gig_id: id });
    for (const r of cached.requirements || []) reqRows.push({ ...r, gig_id: id });
  }
  if (gigs.length === 0) return null;

  gigs.sort((a, b) =>
    a.gig_date !== b.gig_date
      ? a.gig_date < b.gig_date ? -1 : 1
      : (a.band_id || '').localeCompare(b.band_id || '')
  );
  return buildRows(gigs, lineupRows, reqRows);
}

// Everyone gets this grid (admin sees every band's gigs, a band leader
// sees gigs for the bands they lead plus any they personally perform on,
// a plain band member sees just their own gigs) — the `gigs` query below
// has no band_id filter at all, so RLS is the only thing scoping results
// per role. The Band column only appears when more than one band shows
// up in the current result set, so a single-band leader's view stays as
// compact as before.
export default function BandLeaderGigGrid({ onSelectGig, gigsVersion }) {
  // Painted synchronously from whatever's already on the device -- same
  // "instant, then refine in the background" behaviour List/Calendar
  // already get from useOfflineGigList's own lazy-initialized state.
  // Previously this always started blank and showed "Loading gig grid…"
  // for the full length of the live fetch even when a perfectly good
  // cached grid was sitting right there, most noticeable on a slow
  // connection that still eventually succeeds (not a genuine offline/error
  // case at all, just slow -- confirmed live under a simulated slow-3G
  // delay).
  const initialCache = useState(buildFromCache)[0];
  const [rows, setRows] = useState(initialCache?.grouped || []);
  const [showBandColumn, setShowBandColumn] = useState(initialCache?.showBandColumn || false);
  // Only a genuine cold start (nothing cached at all yet) blocks on the
  // live fetch -- otherwise the cached grid above is shown immediately and
  // `syncing` (below) is what indicates a fresher copy is on its way.
  const [loading, setLoading] = useState(!initialCache);
  const [error, setError] = useState(null);
  const [syncing, setSyncing] = useState(false);
  // True whenever the grid currently on screen came from cache rather than
  // a fresh fetch -- previously this silently showed stale data with no
  // indication at all, unlike every other offline-aware view in the app.
  // Seeded true here since the initial paint above, if any, is exactly
  // that. See the banner in the render below.
  const [usingCache, setUsingCache] = useState(Boolean(initialCache));
  // Mirrors rows.length in a ref so load() below can check "is there
  // already something on screen" without needing `rows` in its own
  // useCallback deps -- that would give it a new identity on every
  // successful fetch, which would retrigger the effect that calls it,
  // i.e. a fetch loop.
  const hasRowsRef = useRef(rows.length > 0);
  useEffect(() => { hasRowsRef.current = rows.length > 0; }, [rows]);

  // The sticky month row needs to sit right below the sticky header, not
  // under it -- its `top` offset has to equal the header's actual rendered
  // height, which shifts with the font-size the header switches to at
  // each breakpoint (and if the header's own content ever changes). A
  // ResizeObserver keeps that offset correct instead of hardcoding a
  // number per breakpoint that would silently drift out of sync.
  const theadRef = useRef(null);
  const [headerH, setHeaderH] = useState(30);
  useEffect(() => {
    const el = theadRef.current;
    if (!el) return;
    const update = () => setHeaderH(el.getBoundingClientRect().height);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Falls back to whatever's cached -- used both when genuinely offline and
  // when a fresh fetch fails for what looks like a network reason. Distinct
  // from the initial paint above (which runs once, synchronously, before
  // any fetch is even attempted): this is the "tried live, couldn't, here's
  // the last-known-good instead" path, same shape as every other
  // offline-aware view's own fallback.
  const loadFromCache = useCallback(() => {
    const result = buildFromCache();
    if (!result) {
      setError(OFFLINE_MESSAGE);
      setUsingCache(false);
      setRows([]);
      setLoading(false);
      setSyncing(false);
      return;
    }
    setRows(result.grouped);
    setShowBandColumn(result.showBandColumn);
    setError(null);
    setUsingCache(true);
    setLoading(false);
    setSyncing(false);
  }, []);

  const load = useCallback(async () => {
    // A cold start (nothing painted yet) blocks the whole view on this
    // fetch, same as before. Once something's on screen -- the initial
    // cache paint, or any previous successful load -- this is a quiet
    // background refresh instead (`syncing`), so a slow connection that's
    // still going to succeed doesn't blank out a perfectly good grid for
    // however long that takes.
    setLoading(!hasRowsRef.current);
    setSyncing(true);
    setError(null);

    if (!navigator.onLine) {
      loadFromCache();
      return;
    }

    const { data: gigs, error: gigsError } = await supabase
      .from('gigs')
      .select('id, band_id, gig_date, load_in_time, start_time, end_time, needs_dj, needs_roadie, venues(address), bands(name)')
      .gte('gig_date', todayStr())
      .neq('status', 'cancelled')
      .order('gig_date', { ascending: true })
      .order('band_id', { ascending: true });

    if (gigsError) {
      // Fails for what looks like a network reason despite navigator.onLine
      // still reading true (flaky wifi, a captive portal) -- fall back to
      // whatever's cached rather than just showing an error, same
      // resilience useOfflineGigList already has for List/Calendar.
      if (isLikelyOfflineError(gigsError)) { loadFromCache(); return; }
      setError(gigsError.message);
      setLoading(false);
      setSyncing(false);
      return;
    }

    const gigIds = (gigs || []).map((g) => g.id);
    if (gigIds.length === 0) {
      setRows([]);
      setUsingCache(false);
      setLoading(false);
      setSyncing(false);
      return;
    }

    const [{ data: lineupRows, error: lineupError }, { data: reqRows, error: reqError }] = await Promise.all([
      supabase
        .from('gig_lineup')
        .select('gig_id, profile_id, placeholder_id, confirmed, is_captain, is_dj, is_roadie, profiles(full_name), placeholder_musicians(name), instruments(name)')
        .in('gig_id', gigIds),
      supabase
        .from('gig_requirements')
        .select('gig_id, quantity, instruments(name)')
        .in('gig_id', gigIds),
    ]);

    // Previously ignored -- a network failure on either of these left the
    // grid silently rendering with an empty roster/requirements per cell
    // instead of surfacing anything was wrong.
    const rosterError = lineupError || reqError;
    if (rosterError) {
      if (isLikelyOfflineError(rosterError)) { loadFromCache(); return; }
      setError(rosterError.message);
      setLoading(false);
      setSyncing(false);
      return;
    }

    const { grouped, showBandColumn: sbc } = buildRows(gigs, lineupRows, reqRows);
    setRows(grouped);
    setShowBandColumn(sbc);
    setUsingCache(false);
    setLoading(false);
    setSyncing(false);
  }, [loadFromCache]);

  // Reload the moment connectivity returns -- without this, a grid opened
  // while offline (serving cached data, if any existed) keeps showing that
  // snapshot until this component happens to unmount/remount.
  const isOffline = useIsOffline(load);

  useEffect(() => {
    load();
    // gigsVersion is otherwise unused here -- it's a signal, not data. This
    // component keeps its own independent gigs fetch, entirely separate from
    // GigsList.jsx's shared rawGigs (which List/Calendar already consume as
    // a prop), so nothing else tells it a gig was added/edited elsewhere.
    // GigsList bumps this prop alongside every existing refresh it already
    // does, specifically to give this effect a reason to re-run too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, gigsVersion]);

  if (loading) return <p className="state-message">Loading gig grid…</p>;
  if (error) return <p className="state-message state-message--error">Couldn't load: {error}</p>;
  if (rows.length === 0) {
    return <p className="state-message">No upcoming gigs.</p>;
  }

  const totalCols = BASE_TOTAL_COLS + (showBandColumn ? 1 : 0);
  const colWidths = colWidthPercents(showBandColumn);
  let prevMonth = null;

  return (
    <div className="gig-grid-wrap">
      {usingCache && !syncing && (
        <p className="field__hint" style={{ marginBottom: 10, color: 'var(--rust)' }}>
          {isOffline ? '● Offline' : '⚠ Connection trouble'} — showing the grid as it was last saved to this device. Numbers may be out of date until you're back online.
        </p>
      )}
      {syncing && (
        <div className="sync-bar sync-bar--online" style={{ marginBottom: 10 }}>
          <div className="sync-bar__left">
            <span className="sync-bar__dot sync-bar__dot--online" />
            <span>Syncing gigs…</span>
          </div>
        </div>
      )}
      <div className="gig-grid" style={{ '--gig-grid-header-h': headerH + 'px' }}>
        <table>
          <colgroup>
            {colWidths.map((c) => (
              <col key={c.key} style={{ width: c.widthPercent + '%' }} />
            ))}
          </colgroup>
          <thead ref={theadRef}>
            <tr>
              <th>Date</th>
              {showBandColumn && <th>Band</th>}
              <th>Town</th>
              <th title="Arrival">Arr</th>
              <th title="Band members required">Req</th>
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
                  onSelectGig={onSelectGig}
                />
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="gig-grid__legend">
        Drm Drummer (percussion below) &nbsp;·&nbsp; Bas Bass &nbsp;·&nbsp; Gtr Guitar 1 &nbsp;·&nbsp; Gt2/Key Guitar 2, Keys, Sax or other &nbsp;·&nbsp; Vox Singer &nbsp;·&nbsp; DJ DJ &nbsp;·&nbsp; Rd Roadie &nbsp;·&nbsp; Req band members required &nbsp;·&nbsp; (initials) also covering another role &nbsp;·&nbsp; <span className="gig-grid__line--pending" style={{ padding: '0 4px' }}>yellow</span> not yet confirmed
      </p>
    </div>
  );
}

function GigGroupRows({ group, showMonthRow, monthLabel, showBandColumn, totalCols, onSelectGig }) {
  return (
    <>
      {showMonthRow && (
        <tr className="gig-grid__month-row">
          <td colSpan={totalCols}>{monthLabel}</td>
        </tr>
      )}
      {group.map((gig, idx) => (
        <tr
          key={gig.id}
          className={onSelectGig ? 'gig-grid__row--clickable' : undefined}
          onClick={onSelectGig ? () => onSelectGig(gig.id) : undefined}
        >
          {idx === 0 && (
            <td rowSpan={group.length} className="gig-grid__date">
              {formatCompactDate(gig.gig_date)}
            </td>
          )}
          {showBandColumn && <td>{gig.bandName}</td>}
          <td>{gig.town}</td>
          <td>{formatTime(gig.arrival)}</td>
          <td>{gig.requiredTotal || '—'}</td>
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
          const className = 'gig-grid__line'
            + (person.isCaptain ? ' gig-grid__line--captain' : '')
            + (person.confirmed ? '' : ' gig-grid__line--pending');
          // A repeat appearance (same person already shown in an earlier
          // column on this row, covering a second role e.g. guitar + DJ)
          // is bracketed rather than repeating their initials plainly, so
          // it doesn't read as a second, different person.
          return (
            <div key={i} className={className} title={person.confirmed ? undefined : 'Not yet confirmed'}>
              {person.isRepeat ? '(' + person.initials + ')' : person.initials}
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

import { useState, useMemo } from 'react';
import { WEEKDAY_LABELS, MONTH_LABELS, buildMonthGrid } from '../utils/monthGrid.js';
import { todayStr } from '../utils/formatDate.js';
import { displayBandName } from '../utils/bandName.js';

function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}
function toISO(y, m, d) {
  return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

const MAX_CHIPS_PER_DAY = 2;

function GigChip({ gig, isAdmin, isOffline, isCached, onSelectGig, solo }) {
  const disabled = isOffline && !isCached;
  const venueName = gig.venues?.name;
  const bandName = displayBandName(gig.bands?.name);
  const feeLabel = isAdmin && gig.fee_amount != null
    ? '£' + Math.round(Number(gig.fee_amount)).toLocaleString('en-GB')
    : null;
  const titleBits = [venueName || 'No venue', bandName, feeLabel].filter(Boolean);
  // Solo (only gig that day) gets the whole cell, so there's room for a
  // second line -- band name, and fee for admins -- instead of just the
  // single truncated label a cramped multi-gig chip is limited to.
  const subBits = solo ? [bandName, feeLabel].filter(Boolean) : [];
  return (
    <button
      type="button"
      className={
        'calendar-chip status-tag status-tag--' + gig.status
        + (solo ? ' calendar-chip--solo' : '')
        + (disabled ? ' calendar-chip--offline-unavailable' : '')
      }
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); if (!disabled) onSelectGig(gig.id); }}
      title={titleBits.join(' · ')}
    >
      {gig.start_time && <span className="calendar-chip__time">{gig.start_time.slice(0, 5)}</span>}
      <span className="calendar-chip__label">{venueName || bandName || 'Gig'}</span>
      {subBits.length > 0 && <span className="calendar-chip__sub">{subBits.join(' · ')}</span>}
    </button>
  );
}

function DayPopover({ iso, gigs, isAdmin, isOffline, cachedGigIds, onSelectGig, onAddGig, onClose }) {
  const d = parseISO(iso);
  const label = new Date(d.y, d.m - 1, d.d).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  return (
    <div className="modal-overlay date-picker-overlay" onClick={onClose}>
      <div className="calendar-popover" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="date-picker__close" onClick={onClose} aria-label="Close">×</button>
        <div className="date-picker__title calendar-popover__title">{label}</div>
        <div className="calendar-popover__list">
          {gigs.map((gig) => (
            <GigChip
              key={gig.id}
              gig={gig}
              isAdmin={isAdmin}
              isOffline={isOffline}
              isCached={cachedGigIds.includes(gig.id)}
              onSelectGig={onSelectGig}
            />
          ))}
        </div>
        {isAdmin && (
          <button
            type="button"
            className="btn btn--ghost btn--small calendar-popover__add"
            onClick={() => { onAddGig(iso); onClose(); }}
          >
            + Add another gig on this date
          </button>
        )}
      </div>
    </div>
  );
}

// Month-grid view of gigs, sitting alongside GigsList's flat list as a
// second way to look at the same data -- same 42-cell-always grid algorithm
// as DateInput.jsx's picker (see utils/monthGrid.js), scaled up to a
// full-page layout instead of a small popover. Deliberately takes
// already-fetched gigs as a prop rather than fetching its own -- GigsList
// stays the single source of truth (and the single offline cache) for both
// view modes.
export default function GigCalendar({ gigs, isAdmin, isOffline, cachedGigIds, onSelectGig, onAddGig }) {
  const today = parseISO(todayStr());
  const [viewYear, setViewYear] = useState(today.y);
  const [viewMonth, setViewMonth] = useState(today.m);
  const [popoverDate, setPopoverDate] = useState(null);

  const gigsByDate = useMemo(() => {
    const map = new Map();
    for (const gig of gigs) {
      if (!gig.gig_date) continue;
      if (!map.has(gig.gig_date)) map.set(gig.gig_date, []);
      map.get(gig.gig_date).push(gig);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
    }
    return map;
  }, [gigs]);

  function prevMonth() {
    if (viewMonth === 1) { setViewYear((y) => y - 1); setViewMonth(12); }
    else setViewMonth((m) => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 12) { setViewYear((y) => y + 1); setViewMonth(1); }
    else setViewMonth((m) => m + 1);
  }
  function goToday() {
    setViewYear(today.y);
    setViewMonth(today.m);
  }

  const cells = buildMonthGrid(viewYear, viewMonth);
  const prevM = viewMonth === 1 ? 12 : viewMonth - 1;
  const prevY = viewMonth === 1 ? viewYear - 1 : viewYear;
  const nextM = viewMonth === 12 ? 1 : viewMonth + 1;
  const nextY = viewMonth === 12 ? viewYear + 1 : viewYear;

  const popoverGigs = popoverDate ? gigsByDate.get(popoverDate) || [] : [];

  return (
    <div className="calendar">
      <div className="calendar-header">
        <div className="calendar-header__nav">
          <button type="button" className="date-picker__nav" onClick={prevMonth} aria-label="Previous month">‹</button>
          <span className="date-picker__title">{MONTH_LABELS[viewMonth - 1]} {viewYear}</span>
          <button type="button" className="date-picker__nav" onClick={nextMonth} aria-label="Next month">›</button>
        </div>
        <button type="button" className="btn btn--ghost btn--small" style={{ width: 'auto' }} onClick={goToday}>
          Today
        </button>
      </div>

      <div className="calendar-weekdays" aria-hidden="true">
        {WEEKDAY_LABELS.map((w) => <span key={w}>{w}</span>)}
      </div>

      <div className="calendar-grid">
        {cells.map((c, i) => {
          const y = c.monthOffset === -1 ? prevY : c.monthOffset === 1 ? nextY : viewYear;
          const m = c.monthOffset === -1 ? prevM : c.monthOffset === 1 ? nextM : viewMonth;
          const iso = toISO(y, m, c.day);
          const isToday = today.y === y && today.m === m && today.d === c.day;
          const dayGigs = gigsByDate.get(iso) || [];
          const visibleChips = dayGigs.slice(0, MAX_CHIPS_PER_DAY);
          const overflowCount = dayGigs.length - visibleChips.length;
          const hasGigs = dayGigs.length > 0;
          // Empty day: clicking it starts a new gig on that date (admin
          // only -- band members have no reason to see an add affordance
          // here). A day with gigs already offers both view and add via
          // the popover, so its own cell click still just opens that.
          const canAdd = isAdmin && Boolean(onAddGig);
          const interactive = hasGigs || canAdd;
          const activate = () => { if (hasGigs) setPopoverDate(iso); else if (canAdd) onAddGig(iso); };

          return (
            <div
              key={i}
              className={
                'calendar-day'
                + (c.monthOffset !== 0 ? ' calendar-day--muted' : '')
                + (isToday ? ' calendar-day--today' : '')
                + (hasGigs ? ' calendar-day--has-gigs' : '')
                + (!hasGigs && canAdd ? ' calendar-day--addable' : '')
              }
              role={interactive ? 'button' : undefined}
              tabIndex={interactive ? 0 : undefined}
              aria-label={!hasGigs && canAdd ? 'Add a gig on ' + iso : undefined}
              onClick={interactive ? activate : undefined}
              onKeyDown={interactive ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
              } : undefined}
            >
              <span className="calendar-day__number">{c.day}</span>
              {visibleChips.length > 0 && (
                <div className="calendar-day__chips">
                  {visibleChips.map((gig) => (
                    <GigChip
                      key={gig.id}
                      gig={gig}
                      isAdmin={isAdmin}
                      isOffline={isOffline}
                      isCached={cachedGigIds.includes(gig.id)}
                      onSelectGig={onSelectGig}
                      solo={dayGigs.length === 1}
                    />
                  ))}
                  {overflowCount > 0 && (
                    <button
                      type="button"
                      className="calendar-day__overflow"
                      onClick={(e) => { e.stopPropagation(); setPopoverDate(iso); }}
                    >
                      +{overflowCount} more
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {popoverDate && (
        <DayPopover
          iso={popoverDate}
          gigs={popoverGigs}
          isAdmin={isAdmin}
          isOffline={isOffline}
          cachedGigIds={cachedGigIds}
          onSelectGig={onSelectGig}
          onAddGig={onAddGig}
          onClose={() => setPopoverDate(null)}
        />
      )}
    </div>
  );
}

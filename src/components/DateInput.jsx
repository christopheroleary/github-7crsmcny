import { useState, useRef, useEffect } from 'react';
import { todayStr } from '../utils/formatDate.js';

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function parseISO(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return null;
  return { y, m, d };
}

function toISO(y, m, d) {
  return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

function formatDisplay(iso) {
  const p = parseISO(iso);
  if (!p) return '';
  return new Date(p.y, p.m - 1, p.d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Monday-first index (0=Mon..6=Sun) for a JS Date.getDay() (0=Sun..6=Sat).
function mondayIndex(jsDay) {
  return (jsDay + 6) % 7;
}

// Always exactly 42 cells (6 full weeks) so the panel is the same height
// every month -- otherwise a 4-week Feb next to a 6-week Aug would jump
// the whole page as you page through months.
function buildMonthGrid(year, month) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstWeekday = mondayIndex(new Date(year, month - 1, 1).getDay());
  const prevMonthDays = new Date(year, month - 1, 0).getDate();

  const cells = [];
  for (let i = 0; i < firstWeekday; i++) {
    cells.push({ day: prevMonthDays - firstWeekday + 1 + i, monthOffset: -1 });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, monthOffset: 0 });
  }
  let nextDay = 1;
  while (cells.length < 42) {
    cells.push({ day: nextDay++, monthOffset: 1 });
  }
  return cells;
}

// Custom calendar picker, styled the same on every platform instead of
// deferring to whatever the browser/OS feels like drawing for
// <input type="date"> -- built after a real iPhone showed native date
// fields overlapping each other in a dense row that rendered as a clean
// stack everywhere this was tested. Deliberately a drop-in replacement:
// same value (ISO 'YYYY-MM-DD' or '') and onChange({ target: { value } })
// shape as the native input it replaces, so swapping back is just
// reverting the import if this doesn't feel right.
export default function DateInput({ value, onChange, id, required, placeholder = 'Select a date…' }) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [viewYear, setViewYear] = useState(() => (parseISO(value) || parseISO(todayStr())).y);
  const [viewMonth, setViewMonth] = useState(() => (parseISO(value) || parseISO(todayStr())).m);
  const panelRef = useRef(null);
  const closeTimerRef = useRef(null);

  useEffect(() => () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current); }, []);

  function openPicker() {
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }
    const p = parseISO(value) || parseISO(todayStr());
    setViewYear(p.y);
    setViewMonth(p.m);
    setClosing(false);
    setOpen(true);
  }

  function closePicker() {
    setClosing(true);
    closeTimerRef.current = setTimeout(() => { setOpen(false); setClosing(false); }, 130);
  }

  useEffect(() => {
    if (!open) return;
    function handleKey(e) { if (e.key === 'Escape') closePicker(); }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function select(y, m, d) {
    onChange({ target: { value: toISO(y, m, d) } });
    closePicker();
  }

  function prevMonth() {
    if (viewMonth === 1) { setViewYear((y) => y - 1); setViewMonth(12); }
    else setViewMonth((m) => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 12) { setViewYear((y) => y + 1); setViewMonth(1); }
    else setViewMonth((m) => m + 1);
  }

  const selected = parseISO(value);
  const today = parseISO(todayStr());
  const cells = buildMonthGrid(viewYear, viewMonth);
  const prevM = viewMonth === 1 ? 12 : viewMonth - 1;
  const prevY = viewMonth === 1 ? viewYear - 1 : viewYear;
  const nextM = viewMonth === 12 ? 1 : viewMonth + 1;
  const nextY = viewMonth === 12 ? viewYear + 1 : viewYear;

  return (
    <>
      <input
        type="text"
        className="date-input-trigger"
        id={id}
        readOnly
        required={required}
        value={formatDisplay(value)}
        placeholder={placeholder}
        onClick={openPicker}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(); } }}
      />
      {open && (
        <div className="modal-overlay date-picker-overlay" onClick={closePicker}>
          <div
            className={'date-picker' + (closing ? ' date-picker--closing' : '')}
            ref={panelRef}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="date-picker__header">
              <button type="button" className="date-picker__nav" onClick={prevMonth} aria-label="Previous month">‹</button>
              <span className="date-picker__title">{MONTH_LABELS[viewMonth - 1]} {viewYear}</span>
              <button type="button" className="date-picker__nav" onClick={nextMonth} aria-label="Next month">›</button>
            </div>
            <div className="date-picker__weekdays">
              {WEEKDAY_LABELS.map((w) => <span key={w}>{w}</span>)}
            </div>
            <div className="date-picker__grid">
              {cells.map((c, i) => {
                const y = c.monthOffset === -1 ? prevY : c.monthOffset === 1 ? nextY : viewYear;
                const m = c.monthOffset === -1 ? prevM : c.monthOffset === 1 ? nextM : viewMonth;
                const isSelected = selected && selected.y === y && selected.m === m && selected.d === c.day;
                const isToday = today.y === y && today.m === m && today.d === c.day;
                return (
                  <button
                    type="button"
                    key={i}
                    className={
                      'date-picker__day'
                      + (c.monthOffset !== 0 ? ' date-picker__day--muted' : '')
                      + (isSelected ? ' date-picker__day--selected' : '')
                      + (isToday && !isSelected ? ' date-picker__day--today' : '')
                    }
                    onClick={() => select(y, m, c.day)}
                  >
                    {c.day}
                  </button>
                );
              })}
            </div>
            <div className="date-picker__footer">
              <button type="button" className="link-button" onClick={() => { select(today.y, today.m, today.d); }}>
                Today
              </button>
              {value && (
                <button type="button" className="link-button link-button--danger" onClick={() => { onChange({ target: { value: '' } }); closePicker(); }}>
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

import { useState, useRef, useEffect, useId, forwardRef } from 'react';
import { todayStr } from '../utils/formatDate.js';
import { WEEKDAY_LABELS, MONTH_LABELS, mondayIndex, buildMonthGrid } from '../utils/monthGrid.js';

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

// Custom calendar picker, styled the same on every platform instead of
// deferring to whatever the browser/OS feels like drawing for
// <input type="date"> -- built after a real iPhone showed native date
// fields overlapping each other in a dense row that rendered as a clean
// stack everywhere this was tested. Deliberately a drop-in replacement:
// same value (ISO 'YYYY-MM-DD' or '') and onChange({ target: { value } })
// shape as the native input it replaces, so swapping back is just
// reverting the import if this doesn't feel right.
// Forwards a ref to the real trigger <input> -- lets a caller with its
// own required-field validation (GigForm.jsx, since this input's own
// `required` attribute is silently ignored by the browser: per spec, a
// readOnly input -- which this is, since typing directly into it isn't
// how you pick a date here -- is barred from constraint validation
// entirely) scroll to and focus it after a failed submit.
const DateInput = forwardRef(function DateInput({ value, onChange, id, required, placeholder = 'Select a date…', className = '' }, ref) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [viewYear, setViewYear] = useState(() => (parseISO(value) || parseISO(todayStr())).y);
  const [viewMonth, setViewMonth] = useState(() => (parseISO(value) || parseISO(todayStr())).m);
  const [focusDate, setFocusDate] = useState(() => parseISO(value) || parseISO(todayStr()));
  const panelRef = useRef(null);
  const closeTimerRef = useRef(null);
  const dayButtonRefs = useRef({});
  const panelId = useId();

  useEffect(() => () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current); }, []);

  function openPicker() {
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }
    const p = parseISO(value) || parseISO(todayStr());
    setViewYear(p.y);
    setViewMonth(p.m);
    setFocusDate(p);
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

  // Move real DOM focus onto the roving-tabindex cell whenever it changes --
  // on open (standard modal behaviour: focus lands on the relevant date)
  // and after arrow-key navigation moves it elsewhere, possibly into a
  // month that just came into view.
  useEffect(() => {
    if (!open) return;
    const key = toISO(focusDate.y, focusDate.m, focusDate.d);
    dayButtonRefs.current[key]?.focus();
  }, [open, focusDate, viewYear, viewMonth]);

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

  function applyFocusDate(d) {
    const next = { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
    setFocusDate(next);
    if (next.y !== viewYear || next.m !== viewMonth) {
      setViewYear(next.y);
      setViewMonth(next.m);
    }
  }

  function handleGridKeyDown(e) {
    const deltas = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in deltas) {
      e.preventDefault();
      const d = new Date(focusDate.y, focusDate.m - 1, focusDate.d);
      d.setDate(d.getDate() + deltas[e.key]);
      applyFocusDate(d);
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      const d = new Date(focusDate.y, focusDate.m - 1, focusDate.d);
      d.setDate(d.getDate() - mondayIndex(d.getDay()));
      applyFocusDate(d);
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      const d = new Date(focusDate.y, focusDate.m - 1, focusDate.d);
      d.setDate(d.getDate() + (6 - mondayIndex(d.getDay())));
      applyFocusDate(d);
      return;
    }
    if (e.key === 'PageUp') {
      e.preventDefault();
      const d = new Date(focusDate.y, focusDate.m - 1 + (e.shiftKey ? -12 : -1), focusDate.d);
      applyFocusDate(d);
      return;
    }
    if (e.key === 'PageDown') {
      e.preventDefault();
      const d = new Date(focusDate.y, focusDate.m - 1 + (e.shiftKey ? 12 : 1), focusDate.d);
      applyFocusDate(d);
    }
  }

  const selected = parseISO(value);
  const today = parseISO(todayStr());
  const cells = buildMonthGrid(viewYear, viewMonth);
  const prevM = viewMonth === 1 ? 12 : viewMonth - 1;
  const prevY = viewMonth === 1 ? viewYear - 1 : viewYear;
  const nextM = viewMonth === 12 ? 1 : viewMonth + 1;
  const nextY = viewMonth === 12 ? viewYear + 1 : viewYear;

  dayButtonRefs.current = {};

  return (
    <>
      <input
        ref={ref}
        type="text"
        className={'date-input-trigger' + (className ? ' ' + className : '')}
        id={id}
        readOnly
        required={required}
        value={formatDisplay(value)}
        placeholder={placeholder}
        onClick={openPicker}
        onKeyDown={(e) => {
          if (open) return; // already open -- the dialog's own keydown handling owns this keypress
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(); }
        }}
        role="combobox"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        aria-readonly="true"
      />
      {open && (
        <div className="modal-overlay date-picker-overlay" onClick={closePicker}>
          <div
            className={'date-picker' + (closing ? ' date-picker--closing' : '')}
            ref={panelRef}
            onClick={(e) => e.stopPropagation()}
            id={panelId}
            role="dialog"
            aria-modal="true"
            aria-label="Choose a date"
          >
            <button type="button" className="date-picker__close" onClick={closePicker} aria-label="Close">×</button>
            <div className="date-picker__header">
              <button type="button" className="date-picker__nav" onClick={prevMonth} aria-label="Previous month">‹</button>
              <span className="date-picker__title">{MONTH_LABELS[viewMonth - 1]} {viewYear}</span>
              <button type="button" className="date-picker__nav" onClick={nextMonth} aria-label="Next month">›</button>
            </div>
            <div className="date-picker__weekdays" aria-hidden="true">
              {WEEKDAY_LABELS.map((w) => <span key={w}>{w}</span>)}
            </div>
            <div
              className="date-picker__grid"
              role="listbox"
              aria-label={`${MONTH_LABELS[viewMonth - 1]} ${viewYear}`}
              onKeyDown={handleGridKeyDown}
            >
              {cells.map((c, i) => {
                const y = c.monthOffset === -1 ? prevY : c.monthOffset === 1 ? nextY : viewYear;
                const m = c.monthOffset === -1 ? prevM : c.monthOffset === 1 ? nextM : viewMonth;
                const isSelected = selected && selected.y === y && selected.m === m && selected.d === c.day;
                const isToday = today.y === y && today.m === m && today.d === c.day;
                const isFocused = focusDate.y === y && focusDate.m === m && focusDate.d === c.day;
                const iso = toISO(y, m, c.day);
                return (
                  <button
                    type="button"
                    key={i}
                    ref={(el) => { dayButtonRefs.current[iso] = el; }}
                    tabIndex={isFocused ? 0 : -1}
                    role="option"
                    aria-selected={Boolean(isSelected)}
                    aria-current={isToday ? 'date' : undefined}
                    aria-label={`${c.day} ${MONTH_LABELS[m - 1]} ${y}`}
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
});

export default DateInput;

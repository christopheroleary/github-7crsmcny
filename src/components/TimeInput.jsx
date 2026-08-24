import { useState, useRef, useEffect, useId } from 'react';

const TIME_OPTIONS = [];
for (let h = 0; h < 24; h++) {
  for (const m of [0, 30]) {
    TIME_OPTIONS.push(String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'));
  }
}
const LIST_COLUMNS = 4;
const DEFAULT_OPEN_INDEX = TIME_OPTIONS.indexOf('18:00');

function isValidTime(v) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

// Auto-inserts the colon as the user types digits, rather than requiring
// them to type it themselves -- on a phone's numeric keypad (inputMode
// "numeric" below) there's no colon key at all, so without this a value
// typed from scratch (e.g. after backspacing the field empty) could never
// pass isValidTime() and the Set button would stay permanently disabled.
// Reformats from scratch on every keystroke, so backspacing works exactly
// like deleting from any plain text field -- there's no separate hour/
// minute field to manage the boundary between.
function formatTimeDigits(raw) {
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  return digits.length <= 2 ? digits : digits.slice(0, 2) + ':' + digits.slice(2);
}

// Custom picker, same GUI on every platform instead of the OS-native time
// control -- the DateInput.jsx sibling to this. Drop-in replacement: same
// value ('HH:MM' or '') and onChange({ target: { value } }) shape as the
// native <input type="time"> this replaces. Offers the 30-min list this
// component always suggested, plus free typing for anything in between
// (a load-in at 14:15 shouldn't need fighting a picker that only knows
// half-hours).
export default function TimeInput({ value, onChange, id, required, placeholder = 'Select a time…' }) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [customValue, setCustomValue] = useState(value || '');
  const [focusedIndex, setFocusedIndex] = useState(0);
  const closeTimerRef = useRef(null);
  const optionRefs = useRef([]);
  const customInputRef = useRef(null);
  const panelId = useId();

  useEffect(() => () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current); }, []);

  function openPicker() {
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }
    setCustomValue(value || '');
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

  // Line up the roving-tabindex position with wherever the current value
  // (or the nearest option) is, and scroll it into view. Doesn't steal DOM
  // focus from the manual-entry field -- that only happens once the user
  // actually starts navigating the list with arrow keys.
  useEffect(() => {
    if (!open) return;
    const idx = TIME_OPTIONS.indexOf(value);
    // No value set yet -- open scrolled to a sensible evening default (most
    // gig times cluster around load-in/on-stage in the evening) rather than
    // dumping the list at 00:00, which is rarely what anyone's picking.
    setFocusedIndex(idx >= 0 ? idx : DEFAULT_OPEN_INDEX);
  }, [open, value]);

  // Auto-focus the manual-entry field on open so desktop users can just
  // start typing -- but only on a fine pointer (mouse/trackpad). On a
  // touchscreen this would pop the on-screen keyboard immediately and
  // bury the whole option grid behind it before the user's even seen it.
  useEffect(() => {
    if (!open) return;
    const isTouch = window.matchMedia('(pointer: coarse)').matches;
    if (!isTouch) customInputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    optionRefs.current[focusedIndex]?.scrollIntoView({ block: 'center' });
  }, [open, focusedIndex]);

  function select(t) {
    onChange({ target: { value: t } });
    closePicker();
  }

  function handleCustomSubmit() {
    if (isValidTime(customValue)) select(customValue);
  }

  function moveListFocus(nextIndex) {
    const clamped = Math.min(TIME_OPTIONS.length - 1, Math.max(0, nextIndex));
    setFocusedIndex(clamped);
    optionRefs.current[clamped]?.focus();
  }

  function handleListKeyDown(e) {
    const deltas = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -LIST_COLUMNS, ArrowDown: LIST_COLUMNS };
    if (e.key in deltas) {
      e.preventDefault();
      moveListFocus(focusedIndex + deltas[e.key]);
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      moveListFocus(0);
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      moveListFocus(TIME_OPTIONS.length - 1);
    }
  }

  return (
    <>
      <input
        type="text"
        className="time-input-trigger"
        id={id}
        readOnly
        required={required}
        value={value || ''}
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
            className={'time-picker' + (closing ? ' date-picker--closing' : '')}
            onClick={(e) => e.stopPropagation()}
            id={panelId}
            role="dialog"
            aria-modal="true"
            aria-label="Choose a time"
          >
            <button type="button" className="date-picker__close" onClick={closePicker} aria-label="Close">×</button>
            <div className="time-picker__custom">
              <input
                type="text"
                inputMode="numeric"
                placeholder="HH:MM"
                aria-label="Time, 24-hour format, hours colon minutes"
                aria-invalid={customValue !== '' && !isValidTime(customValue)}
                value={customValue}
                onChange={(e) => setCustomValue(formatTimeDigits(e.target.value))}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleCustomSubmit(); } }}
                ref={customInputRef}
              />
              <button type="button" className="btn btn--primary btn--small" disabled={!isValidTime(customValue)} onClick={handleCustomSubmit}>
                Set
              </button>
            </div>
            <div
              className="time-picker__list"
              role="listbox"
              aria-label="Time options"
              onKeyDown={handleListKeyDown}
            >
              {TIME_OPTIONS.map((t, i) => (
                <button
                  type="button"
                  key={t}
                  ref={(el) => { optionRefs.current[i] = el; }}
                  tabIndex={i === focusedIndex ? 0 : -1}
                  role="option"
                  aria-selected={t === value}
                  className={'time-picker__option' + (t === value ? ' time-picker__option--selected' : '')}
                  onClick={() => select(t)}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

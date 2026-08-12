import { useState, useRef, useEffect } from 'react';

const TIME_OPTIONS = [];
for (let h = 0; h < 24; h++) {
  for (const m of [0, 30]) {
    TIME_OPTIONS.push(String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'));
  }
}

function isValidTime(v) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
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
  const closeTimerRef = useRef(null);
  const listRef = useRef(null);

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

  // Jump straight to wherever the current value (or the nearest option) is
  // rather than always opening scrolled to midnight.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const target = listRef.current.querySelector('.time-picker__option--selected') || listRef.current.querySelector('.time-picker__option');
    target?.scrollIntoView({ block: 'center' });
  }, [open]);

  function select(t) {
    onChange({ target: { value: t } });
    closePicker();
  }

  function handleCustomSubmit() {
    if (isValidTime(customValue)) select(customValue);
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
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(); } }}
      />
      {open && (
        <div className="modal-overlay date-picker-overlay" onClick={closePicker}>
          <div className={'time-picker' + (closing ? ' date-picker--closing' : '')} onClick={(e) => e.stopPropagation()}>
            <button type="button" className="date-picker__close" onClick={closePicker} aria-label="Close">×</button>
            <div className="time-picker__custom">
              <input
                type="text"
                inputMode="numeric"
                placeholder="HH:MM"
                value={customValue}
                onChange={(e) => setCustomValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleCustomSubmit(); } }}
                autoFocus
              />
              <button type="button" className="btn btn--primary btn--small" disabled={!isValidTime(customValue)} onClick={handleCustomSubmit}>
                Set
              </button>
            </div>
            <div className="time-picker__list" ref={listRef}>
              {TIME_OPTIONS.map((t) => (
                <button
                  type="button"
                  key={t}
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

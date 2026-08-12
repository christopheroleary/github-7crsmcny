import { useState, useRef, useEffect, useId } from 'react';

const PAD_KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', '⌫'];

function clampAndFormat(raw, decimals, min, max) {
  if (raw === '' || raw === '.') return '';
  let n = Number(raw);
  if (Number.isNaN(n)) return '';
  if (min != null) n = Math.max(min, n);
  if (max != null) n = Math.min(max, n);
  return decimals > 0 ? n.toFixed(decimals) : String(Math.round(n));
}

function formatDisplay(value, decimals, prefix, suffix) {
  if (value === '' || value == null) return '';
  const n = Number(value);
  if (Number.isNaN(n)) return '';
  const formatted = decimals > 0 ? n.toFixed(decimals) : String(Math.round(n));
  return prefix + formatted + suffix;
}

// Custom numeric/money keypad, the NumberInput sibling to DateInput.jsx and
// TimeInput.jsx -- same reasoning: one predictable GUI on every platform
// instead of <input type="number">, which brings two real problems of its
// own. First, the on-screen keyboard it summons on a phone is full QWERTY
// (numbers behind a shift/symbols tap), not a number pad. Second, and worse,
// Chrome/Firefox change a focused number input's value when the page is
// scrolled with the mouse wheel over it -- silently editing a fee or a
// mileage rate as a side effect of scrolling past it. A text-mode trigger
// plus a purpose-built keypad panel structurally can't do either.
//
// Deliberately a fresh-entry keypad (like a card reader's amount screen)
// rather than an edit-in-place text field: opening it always starts from a
// blank slate rather than requiring the old value to be backspaced away
// first -- the exact complaint that started this. Only Done and Enter
// commit what's been typed; Escape, the backdrop, and × always cancel and
// leave the original value untouched, typed or not -- ordinary dialog
// behaviour, and the only sane response to a change of mind mid-entry.
//
// Drop-in replacement: same value ('123.45' or '' as a plain numeric
// string, no currency symbol) and onChange({ target: { value } }) shape as
// the native <input type="number"> it replaces, so reverting is just
// swapping the import back if this doesn't feel right.
export default function NumberInput({
  value,
  onChange,
  onClose,
  id,
  required,
  decimals = 0,
  min,
  max,
  prefix = '',
  suffix = '',
  placeholder = 'Enter a number…',
  className,
  style,
}) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [draft, setDraft] = useState('');
  const [touched, setTouched] = useState(false);
  const closeTimerRef = useRef(null);
  // The live-typing effect below pushes every keystroke straight into the
  // parent's state (so a running total tracks it as you type), which means
  // the `value` prop itself drifts away from what it was when the panel
  // opened. Cancelling has to restore *that* snapshot, not the current
  // (already-mutated) prop -- otherwise "restoring the original" is really
  // just re-sending the value that's already there.
  const openedWithRef = useRef(value);
  const panelId = useId();

  useEffect(() => () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current); }, []);

  function openPicker() {
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }
    openedWithRef.current = value;
    setDraft('');
    setTouched(false);
    setClosing(false);
    setOpen(true);
  }

  function startClosing() {
    setClosing(true);
    closeTimerRef.current = setTimeout(() => { setOpen(false); setClosing(false); }, 130);
  }

  // Done / Enter confirm whatever's been typed. Escape, the × button, and
  // tapping the backdrop all cancel instead -- ordinary dialog conventions,
  // and the only sane behaviour for a change-of-mind: nobody expects tapping
  // outside a half-typed amount to *save* the half-typed amount.
  function confirmClose() {
    const final = touched ? clampAndFormat(draft, decimals, min, max) : openedWithRef.current;
    if (touched) onChange({ target: { value: final } });
    onClose?.(final);
    startClosing();
  }
  function cancelClose() {
    if (touched) onChange({ target: { value: openedWithRef.current } });
    onClose?.(openedWithRef.current);
    startClosing();
  }

  // Fires as soon as a key is pressed (not on open, where draft is still
  // '') so a live total elsewhere on the page tracks what's being typed --
  // matching how the line-item total already behaves. The properly padded/
  // clamped value is sent once more on close, in case the user stopped
  // typing partway through (e.g. "75" with two decimal places configured).
  useEffect(() => {
    if (!open || !touched) return;
    onChange({ target: { value: draft } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, touched]);

  // Every keystroke is a single validated append or a single character
  // removed -- there is no path where a pasted or typed string reaches
  // state unsanitized, unlike a plain text field with inputMode="decimal".
  function pressDigit(d) {
    setTouched(true);
    setDraft((cur) => {
      if (d === '.') {
        if (decimals === 0 || cur.includes('.')) return cur;
        return cur === '' ? '0.' : cur + '.';
      }
      if (cur === '0') return d;
      if (cur.includes('.')) {
        const frac = cur.split('.')[1] || '';
        if (frac.length >= decimals) return cur;
      }
      if (cur.replace('.', '').length >= 10) return cur; // sane upper bound on digit count
      return cur + d;
    });
  }
  function pressBackspace() {
    setTouched(true);
    setDraft((cur) => cur.slice(0, -1));
  }
  function pressClear() {
    setTouched(true);
    setDraft('');
  }

  // cancelClose/confirmClose read touched/draft/value directly (not via a
  // setState updater), so this listener has to rebind whenever any of them
  // change -- otherwise Escape/Enter close over whatever those were the
  // instant the panel opened, before a single digit had been typed.
  useEffect(() => {
    if (!open) return;
    function handleKey(e) {
      if (e.key === 'Escape') { cancelClose(); return; }
      if (e.key === 'Enter') { e.preventDefault(); confirmClose(); return; }
      if (e.key === 'Backspace') { e.preventDefault(); pressBackspace(); return; }
      if (e.key >= '0' && e.key <= '9') { pressDigit(e.key); return; }
      if (e.key === '.' && decimals > 0) { pressDigit('.'); }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, decimals, touched, draft, min, max]);

  const displayValue = touched
    ? (draft === '' ? '' : prefix + draft + suffix)
    : formatDisplay(value, decimals, prefix, suffix);

  return (
    <>
      <input
        type="text"
        className={'number-input-trigger' + (className ? ' ' + className : '')}
        style={style}
        id={id}
        readOnly
        required={required}
        value={formatDisplay(value, decimals, prefix, suffix)}
        placeholder={placeholder}
        onClick={openPicker}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(); } }}
        role="combobox"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        aria-readonly="true"
      />
      {open && (
        <div className="modal-overlay date-picker-overlay" onClick={cancelClose}>
          <div
            className={'number-picker' + (closing ? ' date-picker--closing' : '')}
            onClick={(e) => e.stopPropagation()}
            id={panelId}
            role="dialog"
            aria-modal="true"
            aria-label="Enter a number"
          >
            <button type="button" className="date-picker__close" onClick={cancelClose} aria-label="Close">×</button>
            <div
              className={'number-picker__display' + (displayValue === '' ? ' number-picker__display--empty' : '')}
              aria-live="polite"
            >
              {displayValue === '' ? (placeholder.replace('…', '') || '0') : displayValue}
            </div>
            <div className="number-picker__pad">
              {PAD_KEYS.map((k) => {
                if (k === '.' && decimals === 0) {
                  return <span key="dot-spacer" className="number-picker__key number-picker__key--empty" />;
                }
                if (k === '⌫') {
                  return (
                    <button
                      type="button"
                      key="backspace"
                      className="number-picker__key number-picker__key--backspace"
                      onClick={pressBackspace}
                      aria-label="Delete last digit"
                    >
                      ⌫
                    </button>
                  );
                }
                return (
                  <button type="button" key={k} className="number-picker__key" onClick={() => pressDigit(k)}>
                    {k}
                  </button>
                );
              })}
            </div>
            <div className="number-picker__footer">
              <button type="button" className="link-button link-button--danger" onClick={pressClear}>
                Clear
              </button>
              <button type="button" className="btn btn--primary btn--small" onClick={confirmClose}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

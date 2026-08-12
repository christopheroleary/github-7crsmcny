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
  // Mirrors of `touched`/`draft`, updated synchronously in the same call
  // that sets the state. confirmClose/cancelClose read these instead of the
  // state directly -- refs are shared across every render's closure, so
  // there's no window where a keydown lands on a handler that still thinks
  // nothing's been typed yet. (There was: two keydown events fired back to
  // back -- a digit, then Enter -- could have the Enter one processed
  // before React had re-run the effect below with a fresh closure over the
  // just-updated `touched`/`draft` state, so it read stale `touched=false`
  // and silently fell back to the original value instead of what was just
  // typed. Refs make that timing irrelevant.)
  const touchedRef = useRef(false);
  const draftRef = useRef('');
  const panelRef = useRef(null);
  const panelId = useId();

  useEffect(() => () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current); }, []);

  // Move focus into the dialog when it opens, same as DateInput's grid --
  // standard modal behaviour, and not just cosmetic here: if focus stayed
  // on the trigger, that trigger's own onKeyDown (below) would still be
  // the thing that receives every subsequent keydown, since it's still
  // the target. It calls openPicker() on Enter -- meant only for opening
  // the dialog in the first place -- which resets touchedRef/draftRef to
  // empty. That reset landed *before* this component's own Enter handler
  // ran (both fire off the same keydown, target phase before document's
  // bubble-phase listener), so confirmClose always saw an already-wiped
  // draft and silently discarded whatever had just been typed. Tabbing
  // away from the trigger, or clicking a pad button, sidestepped it by
  // moving focus off the trigger before Enter was ever pressed -- which
  // is the real clue this was a focus issue, not a state one.
  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
  }, [open]);

  function openPicker() {
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }
    openedWithRef.current = value;
    touchedRef.current = false;
    draftRef.current = '';
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
    const final = touchedRef.current ? clampAndFormat(draftRef.current, decimals, min, max) : openedWithRef.current;
    if (touchedRef.current) onChange({ target: { value: final } });
    onClose?.(final);
    startClosing();
  }
  function cancelClose() {
    if (touchedRef.current) onChange({ target: { value: openedWithRef.current } });
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
  //
  // `next` is computed against draftRef.current (not the `cur` a setState
  // updater would hand back) and the ref is written *synchronously*, right
  // here -- not inside the setDraft callback. React doesn't run a state
  // updater function synchronously, so two keydowns handled back to back
  // (e.g. a digit immediately followed by Enter, however that happens --
  // fast typing, or two events dispatched in the same tick) could reach
  // confirmClose before the first updater had ever run, reading a
  // still-empty draftRef and silently saving nothing instead of what was
  // just typed. A plain synchronous assignment closes that gap entirely.
  function pressDigit(d) {
    const cur = draftRef.current;
    let next = cur;
    if (d === '.') {
      if (decimals > 0 && !cur.includes('.')) next = cur === '' ? '0.' : cur + '.';
    } else if (cur === '0') {
      next = d;
    } else if (cur.includes('.') && (cur.split('.')[1] || '').length >= decimals) {
      next = cur;
    } else if (cur.replace('.', '').length < 10) {
      next = cur + d; // sane upper bound on digit count
    }
    touchedRef.current = true;
    draftRef.current = next;
    setTouched(true);
    setDraft(next);
  }
  function pressBackspace() {
    const next = draftRef.current.slice(0, -1);
    touchedRef.current = true;
    draftRef.current = next;
    setTouched(true);
    setDraft(next);
  }
  function pressClear() {
    touchedRef.current = true;
    draftRef.current = '';
    setTouched(true);
    setDraft('');
  }

  // confirmClose/cancelClose read touched/draft via refs (see above), not
  // the state directly, so this listener no longer needs to rebind on
  // every keystroke just to stay correct -- it only needs open/decimals/
  // min/max, which change far less often.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, decimals, min, max]);

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
        onKeyDown={(e) => {
          if (open) return; // already open -- let the dialog's own keydown handling own this keypress
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(); }
        }}
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
            ref={panelRef}
            tabIndex={-1}
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

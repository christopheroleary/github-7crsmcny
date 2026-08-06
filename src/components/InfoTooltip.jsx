import { useState, useRef, useEffect, useLayoutEffect } from 'react';

const PANEL_WIDTH = 230;
const VIEWPORT_MARGIN = 12;

// Click-to-toggle rather than hover-only so it works the same on touch and
// mouse -- a hover tooltip is simply unreachable on a phone.
export default function InfoTooltip({ text }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const [panelStyle, setPanelStyle] = useState(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Position is computed against the viewport (not the trigger's offset
  // parent) and clamped to stay on-screen -- a panel anchored with a plain
  // `left: 0` relative to its trigger overflows the right edge whenever the
  // icon sits in the right half of a narrow (mobile-width) column, which is
  // exactly where most of these triggers live.
  useLayoutEffect(() => {
    if (!open || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const width = Math.min(PANEL_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);
    let left = rect.left;
    if (left + width > window.innerWidth - VIEWPORT_MARGIN) {
      left = window.innerWidth - VIEWPORT_MARGIN - width;
    }
    if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;
    setPanelStyle({ position: 'fixed', top: rect.bottom + 6, left, width });
  }, [open]);

  return (
    <span className="info-tooltip" ref={wrapRef}>
      <button
        type="button"
        className="info-tooltip__trigger"
        onClick={() => setOpen((v) => !v)}
        aria-label="More info"
        aria-expanded={open}
      >
        i
      </button>
      {open && panelStyle && (
        <span className="info-tooltip__panel" style={panelStyle}>{text}</span>
      )}
    </span>
  );
}

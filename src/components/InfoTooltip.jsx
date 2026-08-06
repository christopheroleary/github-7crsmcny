import { useState, useRef, useEffect, useLayoutEffect } from 'react';

const VIEWPORT_MARGIN = 12;
const PANEL_MAX_WIDTH = 230;

// Click-to-toggle rather than hover-only so it works the same on touch and
// mouse -- a hover tooltip is simply unreachable on a phone.
export default function InfoTooltip({ text }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const wrapRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  useEffect(() => {
    if (!open) setPos(null);
  }, [open]);

  // Measure-then-position: the panel first mounts off-screen (real content,
  // real dimensions, just not yet placed), this reads its actual rendered
  // size, then positions it -- both horizontally AND vertically clamped to
  // the viewport, flipping above the trigger when there isn't room below.
  // Runs before paint (useLayoutEffect), so nothing visibly jumps.
  useLayoutEffect(() => {
    if (!open || !wrapRef.current || !panelRef.current) return;
    const triggerRect = wrapRef.current.getBoundingClientRect();
    const panelRect = panelRef.current.getBoundingClientRect();
    const width = Math.min(PANEL_MAX_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);

    let left = triggerRect.left;
    if (left + width > window.innerWidth - VIEWPORT_MARGIN) left = window.innerWidth - VIEWPORT_MARGIN - width;
    if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;

    const spaceBelow = window.innerHeight - triggerRect.bottom;
    const fitsBelow = spaceBelow >= panelRect.height + VIEWPORT_MARGIN;
    const top = fitsBelow
      ? triggerRect.bottom + 6
      : Math.max(VIEWPORT_MARGIN, triggerRect.top - 6 - panelRect.height);

    setPos({ top, left, width });
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
      {open && (
        <span
          ref={panelRef}
          className="info-tooltip__panel"
          style={
            pos
              ? { position: 'fixed', top: pos.top, left: pos.left, width: pos.width }
              : { position: 'fixed', top: 0, left: 0, width: PANEL_MAX_WIDTH, visibility: 'hidden' }
          }
        >
          {text}
        </span>
      )}
    </span>
  );
}

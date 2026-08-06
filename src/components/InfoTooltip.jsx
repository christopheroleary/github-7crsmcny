import { useState, useRef, useEffect } from 'react';

// Click-to-toggle rather than hover-only so it works the same on touch and
// mouse -- a hover tooltip is simply unreachable on a phone.
export default function InfoTooltip({ text }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <span className="info-tooltip" ref={ref}>
      <button
        type="button"
        className="info-tooltip__trigger"
        onClick={() => setOpen((v) => !v)}
        aria-label="More info"
        aria-expanded={open}
      >
        i
      </button>
      {open && <span className="info-tooltip__panel">{text}</span>}
    </span>
  );
}

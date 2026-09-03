import { useEffect, useRef } from 'react';

// The "fold to just its title" wrapper used across GigDetail.jsx -- no
// generic version of this existed before (the closest precedent was
// NearbySection.jsx's own one-off <details><summary> pair), so this
// generalizes that into something every section can share.
//
// `defaultOpen` is applied ONCE, imperatively, on mount -- not passed as
// a plain `open` JSX prop every render. Native <details> would otherwise
// get fought over: React re-setting `open` on every render (as
// `defaultOpen` itself changes, e.g. once a notification's scroll-and-
// open finishes and the caller's `scrollToSection` clears back to null)
// would silently re-collapse a section the user just opened, or one
// they just opened by hand. Once mounted, the browser's own native
// toggle owns it completely.
export default function CollapsibleSection({ id, title, icon, titleExtra, defaultOpen = false, children }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.open = defaultOpen;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <details ref={ref} className="day-sheet__section" id={id}>
      <summary className="day-sheet__section-title collapsible-summary">
        {/* aria-hidden -- purely decorative, the title text alone is
            already the accessible name for this fold. */}
        {icon && <span className="collapsible-summary__icon" aria-hidden="true">{icon}</span>}
        {title}
        {titleExtra}
      </summary>
      <div className="collapsible-body">{children}</div>
    </details>
  );
}

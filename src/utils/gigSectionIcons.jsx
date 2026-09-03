// One icon per foldable section on the gig detail page (GigDetail.jsx's
// CollapsibleSection titles) -- same hand-drawn stroke convention as
// tabIcons.jsx (viewBox 0 0 24 24, stroke=currentColor, strokeWidth 2,
// round caps/joins, fill none), reusing its exact svgProps rather than
// redefining the same object. Two sections (Suppliers, Setlist) reuse an
// existing nav-tab icon outright instead of getting a new one here --
// SuppliersIcon and RepertoireIcon (imported directly from tabIcons.jsx
// wherever those two sections render their own CollapsibleSection) are
// already the right shape for "vendors" and "songs" respectively, and
// reusing them is exactly the point: one consistent icon per concept
// across the whole app, not a second, slightly-different one per screen.
//
// All inline SVG, bundled into the JS same as every other icon in the app
// -- nothing here is fetched, so these render identically with no signal
// at all (confirmed live, see the offline-caching work this session).
import { svgProps } from './tabIcons.jsx';

export function TasksIcon() {
  return (
    <svg {...svgProps}>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="m7.5 8.5 1.5 1.5 3-3" />
      <path d="m7.5 14.5 1.5 1.5 3-3" />
    </svg>
  );
}

export function ChatIcon() {
  return (
    <svg {...svgProps}>
      <path d="M12 3C7 3 3 6.4 3 10.5c0 2.5 1.5 4.7 3.8 6.1L6 21l4.2-2.1c.6.1 1.2.1 1.8.1 5 0 9-3.4 9-7.5S17 3 12 3Z" />
    </svg>
  );
}

export function TravelFeeIcon() {
  // A suitcase, not a car -- tried a car first, but at the 16px this
  // actually renders at, wheels small enough to read as wheels made the
  // whole glyph read as a blob (confirmed live). Bold, simple shapes only.
  return (
    <svg {...svgProps}>
      <rect x="4" y="8" width="16" height="12" rx="2" />
      <path d="M9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
      <path d="M4 13h16" />
    </svg>
  );
}

export function DocumentsIcon() {
  return (
    <svg {...svgProps}>
      <path d="M8 3h6l4 4v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
      <path d="M14 3v4h4" />
      <path d="M9 12.5h6M9 16h4" />
    </svg>
  );
}

export function ClaimsIcon() {
  return (
    <svg {...svgProps}>
      <path d="M6 3h12v17l-2-1.3L14 20l-2-1.3L10 20l-2-1.3L6 20V3Z" />
      <path d="M9 8h6M9 12h6" />
    </svg>
  );
}

export function StagePlotIcon() {
  return (
    <svg {...svgProps}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8" cy="15" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="9" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="16" cy="15" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function DayOfGigIcon() {
  return (
    <svg {...svgProps}>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 9h18M8 2v4M16 2v4" />
      <path d="m12 12.3 1 2 2.2.3-1.6 1.5.4 2.2-2-1.1-2 1.1.4-2.2-1.6-1.5 2.2-.3 1-2Z" fill="currentColor" strokeLinejoin="round" />
    </svg>
  );
}

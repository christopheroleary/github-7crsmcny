// One icon per top-nav tab (App.jsx's adminTabs/bandLeaderTabs/memberTabs/
// personalTabs). Same stroke-icon convention already used for the header's
// UserIcon (viewBox 0 0 24 24, stroke=currentColor, strokeWidth 2, round
// caps/joins, fill none) -- no width/height on the <svg> itself, sizing is
// entirely up to whatever wraps it (see .tab__icon in index.css), so these
// can be reused at a different size elsewhere without editing every path.
// Deliberately hand-drawn rather than pulling in an icon library dependency
// for ~15 icons -- keeps the bundle small and matches the one icon this app
// already had.

// Exported so other hand-drawn icon sets (gigSectionIcons.jsx) can match
// this exact stroke convention rather than each redefining their own copy.
export const svgProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

export function DashboardIcon() {
  return (
    <svg {...svgProps}>
      <rect x="3" y="3" width="8" height="8" rx="1.5" />
      <rect x="13" y="3" width="8" height="5" rx="1.5" />
      <rect x="13" y="12" width="8" height="9" rx="1.5" />
      <rect x="3" y="15" width="8" height="6" rx="1.5" />
    </svg>
  );
}

export function GigsIcon() {
  return (
    <svg {...svgProps}>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 9h18M8 2v4M16 2v4" />
      <circle cx="9" cy="14" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="15" cy="14" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="9" cy="18" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function EnquiriesIcon() {
  return (
    <svg {...svgProps}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3.5 6 8.5 7 8.5-7" />
    </svg>
  );
}

export function VenuesIcon() {
  return (
    <svg {...svgProps}>
      <path d="M12 21s7-6.6 7-12a7 7 0 0 0-14 0c0 5.4 7 12 7 12Z" />
      <circle cx="12" cy="9" r="2.5" />
    </svg>
  );
}

export function ClientsIcon() {
  return (
    <svg {...svgProps}>
      <rect x="3" y="8" width="18" height="12" rx="2" />
      <path d="M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M3 13h18" />
    </svg>
  );
}

export function SuppliersIcon() {
  return (
    <svg {...svgProps}>
      <path d="M21 8v8a1 1 0 0 1-.5.87l-8 4.6a1 1 0 0 1-1 0l-8-4.6A1 1 0 0 1 3 16V8" />
      <path d="m3 8 9-5 9 5-9 5-9-5Z" />
      <path d="M12 13v8" />
    </svg>
  );
}

export function BandsIcon() {
  return (
    <svg {...svgProps}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16.5 6.2a3.2 3.2 0 0 1 0 6.2" />
      <path d="M18.5 14.3A6.5 6.5 0 0 1 21.5 20" />
    </svg>
  );
}

export function MusiciansIcon() {
  return (
    <svg {...svgProps}>
      <rect x="9" y="2.5" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
      <path d="M12 17.5V21M8.5 21h7" />
    </svg>
  );
}

export function RepertoireIcon() {
  return (
    <svg {...svgProps}>
      <path d="M9 18V5l11-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="17" cy="16" r="3" />
    </svg>
  );
}

export function ActivityIcon() {
  return (
    <svg {...svgProps}>
      <path d="M3 12h4l2.5-8 5 16L17 12h4" />
    </svg>
  );
}

export function FeedbackIcon() {
  return (
    <svg {...svgProps}>
      <path d="M4 4h16v12H8l-4 4V4Z" />
      <path d="M8 9h8M8 12.5h5" />
    </svg>
  );
}

export function SettingsIcon() {
  return (
    <svg {...svgProps}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}

export function GetStartedIcon() {
  return (
    <svg {...svgProps}>
      <path d="M12 2c2.5 2.2 4 5.4 4 9 0 3-1.2 5.6-2.6 7.4L12 22l-1.4-3.6C9.2 16.6 8 14 8 11c0-3.6 1.5-6.8 4-9Z" />
      <circle cx="12" cy="10" r="1.8" />
      <path d="M8.5 16 5 17.5 6 14M15.5 16l3.5 1.5-1-3.5" />
    </svg>
  );
}

export function DepProfileIcon() {
  return (
    <svg {...svgProps}>
      <circle cx="10" cy="8" r="3.5" />
      <path d="M3.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="m16.5 12.5 2 2 3.5-4" />
    </svg>
  );
}

export function MoneyIcon() {
  return (
    <svg {...svgProps}>
      <rect x="2.5" y="6" width="19" height="13" rx="2" />
      <path d="M2.5 10h19" />
      <path d="M6 14.5h4" />
    </svg>
  );
}

// Header "What's new" button (App.jsx) -- not a tab icon, but lives here
// alongside the others since it's the same hand-drawn stroke convention.
export function MegaphoneIcon() {
  return (
    <svg {...svgProps}>
      <path d="M3 9h4l9-5v16l-9-5H3z" />
      <rect x="4" y="15" width="3" height="5" rx="1" />
      <path d="M19 8a5 5 0 0 1 0 8" />
    </svg>
  );
}

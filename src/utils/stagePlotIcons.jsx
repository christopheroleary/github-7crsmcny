// Stand-ins for the 13 lucide-react icons StagePlot.jsx imports.
// lucide-react isn't a dependency of this app -- every other icon here is
// either a unicode glyph or a hand-written inline SVG (see NotificationBell's
// bell icon), never a library -- and adding a new npm dependency on this
// exFAT-drive dev environment risks the pnpm [ERR_PNPM_EISDIR] symlink
// failures this session already hit and had to work around twice. Same
// call shape as lucide (size/color/strokeWidth props, 24x24 viewBox,
// round caps/joins), so this is a drop-in for StagePlot.jsx's import line
// and nothing else in that file needs to change.
import React from 'react';

function createIcon(paths) {
  return function Icon({ size = 24, color = 'currentColor', strokeWidth = 2, ...rest }) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        {...rest}
      >
        {paths}
      </svg>
    );
  };
}

export const Plus = createIcon(
  <>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </>
);

export const Trash2 = createIcon(
  <>
    <path d="M3 6h18" />
    <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
    <path d="M19 6v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
  </>
);

export const RotateCcw = createIcon(
  <>
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <path d="M3 3v6h6" />
  </>
);

export const Download = createIcon(
  <>
    <path d="M12 3v12" />
    <path d="M8 11l4 4 4-4" />
    <path d="M4 19h16" />
  </>
);

export const Printer = createIcon(
  <>
    <path d="M6 9V3h12v6" />
    <rect x="4" y="9" width="16" height="8" rx="1" />
    <path d="M8 21h8v-4H8v4z" />
  </>
);

export const Copy = createIcon(
  <>
    <rect x="9" y="9" width="11" height="11" rx="1" />
    <path d="M5 15V5a1 1 0 0 1 1-1h10" />
  </>
);

export const Save = createIcon(
  <>
    <path d="M5 4h11l3 3v13H5V4z" />
    <path d="M8 4v5h8V4" />
    <path d="M8 13h8v6H8z" />
  </>
);

export const FolderOpen = createIcon(
  <>
    <path d="M3 7a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v1H4" />
    <path d="M3 8l1.5 10a1 1 0 0 0 1 .9h13a1 1 0 0 0 1-.9L21 10H4" />
  </>
);

export const Check = createIcon(<path d="M5 12l4 4L19 6" />);

export const X = createIcon(
  <>
    <path d="M6 6l12 12" />
    <path d="M18 6L6 18" />
  </>
);

export const ImageDown = createIcon(
  <>
    <rect x="3" y="3" width="14" height="14" rx="2" />
    <circle cx="8" cy="8" r="1.5" />
    <path d="M3 15l4-4 3 3 3-3 4 4" />
    <path d="M20 15v6" />
    <path d="M17 18l3 3 3-3" />
  </>
);

export const Crosshair = createIcon(
  <>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 2v4" />
    <path d="M12 18v4" />
    <path d="M2 12h4" />
    <path d="M18 12h4" />
  </>
);

export const ClipboardPaste = createIcon(
  <>
    <rect x="6" y="4" width="12" height="16" rx="2" />
    <rect x="9" y="2" width="6" height="4" rx="1" />
    <path d="M9 12h6" />
    <path d="M9 16h4" />
  </>
);

export const Maximize2 = createIcon(
  <>
    <path d="M15 3h6v6" />
    <path d="M9 21H3v-6" />
    <path d="M21 3l-7 7" />
    <path d="M3 21l7-7" />
  </>
);

export const Minimize2 = createIcon(
  <>
    <path d="M9 3v6H3" />
    <path d="M15 21v-6h6" />
    <path d="M3 9l7-7" />
    <path d="M21 15l-7 7" />
  </>
);

export const ZoomIn = createIcon(
  <>
    <circle cx="10" cy="10" r="7" />
    <path d="M10 7v6" />
    <path d="M7 10h6" />
    <path d="M21 21l-5.5-5.5" />
  </>
);

export const ZoomOut = createIcon(
  <>
    <circle cx="10" cy="10" r="7" />
    <path d="M7 10h6" />
    <path d="M21 21l-5.5-5.5" />
  </>
);

export const BringToFront = createIcon(
  <>
    <rect x="9" y="9" width="11" height="11" rx="1.5" />
    <path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
  </>
);

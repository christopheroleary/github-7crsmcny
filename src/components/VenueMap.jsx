import { useState } from 'react';

// Wraps the OpenStreetMap iframe embed with two fixes for a cross-origin
// embed we otherwise can't script at all:
//
// 1. Click-to-activate -- the iframe starts non-interactive (pointer-events:
//    none), so scrolling/swiping straight past it on the page scrolls the
//    PAGE, not the map's own zoom. That's the classic "embedded map eats
//    your trackpad scroll" trap -- same fix Google Maps embeds use. A tap
//    on the map enables it for anyone who actually wants to pan/zoom.
// 2. Reset view -- OSM's plain export/embed endpoint has no postMessage API
//    to reset pan/zoom once someone's moved around, so the only way back to
//    the original pin+bbox is to force the iframe to reload its original
//    src -- done here via a remount key, exposed as a button placed next to
//    where OSM's own +/- zoom control renders (its top-right corner).
export default function VenueMap({ src, title, height = 220 }) {
  const [active, setActive] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  return (
    <div style={{ position: 'relative', marginTop: 12 }}>
      <iframe
        key={resetKey}
        title={title}
        width="100%"
        height={height}
        style={{ border: 0, borderRadius: 12, display: 'block', pointerEvents: active ? 'auto' : 'none' }}
        loading="lazy"
        src={src}
      />
      {!active && (
        <button
          type="button"
          onClick={() => setActive(true)}
          aria-label="Activate map"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            background: 'transparent',
            border: 'none',
            borderRadius: 12,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            padding: 10,
          }}
        >
          <span
            style={{
              background: 'rgba(0,0,0,0.65)',
              color: '#fff',
              fontSize: 12,
              fontWeight: 600,
              padding: '6px 12px',
              borderRadius: 20,
            }}
          >
            Tap to interact with map
          </span>
        </button>
      )}
      {active && (
        <button
          type="button"
          onClick={() => { setActive(false); setResetKey((k) => k + 1); }}
          title="Reset to default view"
          aria-label="Reset to default view"
          style={{
            position: 'absolute',
            top: 8,
            right: 44,
            width: 29,
            height: 29,
            background: '#fff',
            border: '2px solid rgba(0,0,0,0.2)',
            backgroundClip: 'padding-box',
            borderRadius: 2,
            cursor: 'pointer',
            fontSize: 15,
            lineHeight: 1,
            color: '#333',
          }}
        >
          ⟲
        </button>
      )}
    </div>
  );
}

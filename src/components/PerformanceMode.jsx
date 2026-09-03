import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSwipeHorizontal } from '../hooks/useSwipeHorizontal.js';
import { ReferencePlayer } from './SongReference.jsx';
import BackingTrackPlayer from './BackingTrackPlayer.jsx';

// ── Font size ──────────────────────────────────────────────────────────────────
const FONT_SCALES = [
  { id: 'S', label: 'S', scale: 1 },
  { id: 'M', label: 'M', scale: 1.25 },
  { id: 'L', label: 'L', scale: 1.55 },
  { id: 'XL', label: 'XL', scale: 1.9 },
];
const DEFAULT_FONT_INDEX = 1; // M

function readStoredFontIndex() {
  try {
    const raw = localStorage.getItem('performance_mode_font_index');
    const idx = raw == null ? DEFAULT_FONT_INDEX : Number(raw);
    return Number.isInteger(idx) && idx >= 0 && idx < FONT_SCALES.length ? idx : DEFAULT_FONT_INDEX;
  } catch {
    return DEFAULT_FONT_INDEX;
  }
}

// ── Autoscroll ─────────────────────────────────────────────────────────────────
const DEFAULT_AUTOSCROLL_SECONDS = 240; // 4 minutes, per the brief
const MIN_AUTOSCROLL_SECONDS = 30;
const MAX_AUTOSCROLL_SECONDS = 20 * 60;
const AUTOSCROLL_STEP_SECONDS = 30;

function readStoredAutoscrollSeconds() {
  try {
    const raw = localStorage.getItem('performance_mode_autoscroll_seconds');
    const secs = raw == null ? DEFAULT_AUTOSCROLL_SECONDS : Number(raw);
    return Number.isFinite(secs) && secs >= MIN_AUTOSCROLL_SECONDS && secs <= MAX_AUTOSCROLL_SECONDS
      ? secs
      : DEFAULT_AUTOSCROLL_SECONDS;
  } catch {
    return DEFAULT_AUTOSCROLL_SECONDS;
  }
}

function formatDuration(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return m + ':' + String(s).padStart(2, '0');
}

// ── Lyrics rendering ───────────────────────────────────────────────────────────
// Same [Section] convention SongReference.jsx's LyricsView already uses, plus
// a best-effort chord-line detector on top: a line renders as a chord line
// when every whitespace-separated token looks like a chord symbol (root
// A-G, optional #/b, optional quality/extension, optional /bass). This is
// deliberately a heuristic, not a real chord-chart format -- there's no
// separate chords column or ChordPro-style inline tagging anywhere in this
// app, so this works on every song exactly as already entered, with the one
// known gap that a chord written on the same line as lyric words won't be
// caught (uncommon in practice -- chords-on-their-own-line-above-the-lyric
// is how people already type these).
const CHORD_TOKEN_RE = /^[A-G][#b]?(?:maj|min|m|dim|aug|sus[24]?|add\d|\d)*(?:\/[A-G][#b]?)?$/;

function isChordLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return trimmed.split(/\s+/).every((t) => CHORD_TOKEN_RE.test(t));
}

function isSectionLine(line) {
  return /^\[.+\]$/.test(line.trim());
}

function PerformanceLyrics({ text }) {
  if (!text) {
    return <p className="pm-lyrics__empty">No lyrics saved for this song yet.</p>;
  }
  return (
    <div className="pm-lyrics__body">
      {text.split('\n').map((line, i) => {
        if (isSectionLine(line)) return <p key={i} className="pm-lyrics__section">{line}</p>;
        if (isChordLine(line)) return <p key={i} className="pm-lyrics__chord">{line}</p>;
        return <p key={i} className="pm-lyrics__line">{line || ' '}</p>;
      })}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
// Full-screen, swipe-through performer view of a gig's setlist. Deliberately
// takes its song data as a prop rather than fetching it itself -- both call
// sites (GigSetlist.jsx for admins/leaders, GigDetailBandMember.jsx for
// musicians) already have the exact shape loaded (setlists -> setlist_items
// -> songs, position-sorted) before this ever opens, so there's no separate
// query and no new RLS surface to reason about.
export default function PerformanceMode({ setlists, bandId, gigId, backingTrackSongIds, startIndex = 0, isOffline = false, onClose }) {
  // Flattens every attached set into one continuous ordered list (set order,
  // then position within each set) -- "swipe through the whole night" rather
  // than treating sets as separate chapters. _setName is carried along
  // purely for the meta row and the song-list drawer's grouping.
  const songs = useMemo(() => {
    const out = [];
    for (const sl of setlists || []) {
      for (const item of sl.setlist_items || []) {
        if (item.songs) out.push({ ...item.songs, _setName: sl.name });
      }
    }
    return out;
  }, [setlists]);

  const [currentIndex, setCurrentIndex] = useState(() =>
    Math.min(Math.max(startIndex, 0), Math.max(songs.length - 1, 0))
  );
  const [fontIndex, setFontIndex] = useState(readStoredFontIndex);
  const [autoscrollSeconds, setAutoscrollSeconds] = useState(readStoredAutoscrollSeconds);
  const [autoscrollPlaying, setAutoscrollPlaying] = useState(true);
  const [showDrawer, setShowDrawer] = useState(false);
  const [showListen, setShowListen] = useState(false);
  const [showTrack, setShowTrack] = useState(false);

  const lyricsRef = useRef(null);
  const rafRef = useRef(null);

  const song = songs[currentIndex] || null;

  // Defensive clamp -- setlists is prop-driven and could in principle shrink
  // while this is open (a background refresh on the parent page).
  useEffect(() => {
    if (songs.length > 0 && currentIndex > songs.length - 1) {
      setCurrentIndex(songs.length - 1);
    }
  }, [songs.length, currentIndex]);

  const goNext = useCallback(() => {
    setCurrentIndex((i) => Math.min(i + 1, songs.length - 1));
  }, [songs.length]);
  const goPrev = useCallback(() => {
    setCurrentIndex((i) => Math.max(i - 1, 0));
  }, []);

  useSwipeHorizontal(goNext, goPrev, { disabled: showDrawer });

  // Per-device reading preferences, not account-wide -- localStorage rather
  // than the profile table, same reasoning as gig_view in App.jsx.
  useEffect(() => {
    try { localStorage.setItem('performance_mode_font_index', String(fontIndex)); } catch {}
  }, [fontIndex]);
  useEffect(() => {
    try { localStorage.setItem('performance_mode_autoscroll_seconds', String(autoscrollSeconds)); } catch {}
  }, [autoscrollSeconds]);

  // A freshly-opened song always starts scrolled to the top with autoscroll
  // running -- "autoscroll defaulted to 4 minutes when song chosen" from the
  // brief. Also closes any open Listen/Backing track panel from the last
  // song rather than carrying it over onto this one.
  useEffect(() => {
    if (lyricsRef.current) lyricsRef.current.scrollTop = 0;
    setAutoscrollPlaying(true);
    setShowListen(false);
    setShowTrack(false);
  }, [currentIndex]);

  // The autoscroll loop. Computes a remaining-duration proportional to the
  // remaining distance rather than always re-targeting the full
  // autoscrollSeconds -- resuming from halfway through shouldn't take
  // another full 4 minutes to cover the other half. Re-runs (and re-paces)
  // whenever autoscrollSeconds itself is adjusted mid-song too.
  useEffect(() => {
    if (!autoscrollPlaying) return;
    const container = lyricsRef.current;
    if (!container) return;
    const maxScroll = container.scrollHeight - container.clientHeight;
    if (maxScroll <= 0) return; // fits on screen -- nothing to scroll
    const startScrollTop = container.scrollTop;
    const remainingFraction = 1 - startScrollTop / maxScroll;
    const remainingMs = autoscrollSeconds * 1000 * remainingFraction;
    if (remainingMs <= 0) {
      setAutoscrollPlaying(false);
      return;
    }
    const startTime = performance.now();
    function step(now) {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / remainingMs);
      container.scrollTop = startScrollTop + progress * (maxScroll - startScrollTop);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        setAutoscrollPlaying(false);
      }
    }
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [autoscrollPlaying, currentIndex, autoscrollSeconds]);

  // Screen Wake Lock -- the whole point of this view is being read from
  // mid-song, so the phone dimming/locking the screen partway through
  // defeats it. Feature-detected and wrapped defensively: silently does
  // nothing on a browser/context that doesn't support it (e.g. Safari
  // < 16.4) rather than surfacing an error for something genuinely optional.
  useEffect(() => {
    let lock = null;
    let cancelled = false;
    if ('wakeLock' in navigator) {
      navigator.wakeLock
        .request('screen')
        .then((l) => {
          if (cancelled) { l.release().catch(() => {}); return; }
          lock = l;
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
      lock?.release().catch(() => {});
    };
  }, []);

  if (!song) {
    return (
      <div className="performance-mode">
        <div className="pm-empty">
          <p>No songs in this setlist yet.</p>
          <button className="btn btn--primary" onClick={onClose}>Close</button>
        </div>
      </div>
    );
  }

  // Matches the same !isOffline gate the plain (non-performance-mode)
  // day-sheet setlist view already applies to these two -- lyrics/key/bpm
  // are cached and fine offline, but the reference embed and the backing
  // track's audio file both need a real connection.
  const canListen = !isOffline && !!song.reference_url;
  const hasBackingTrack = !isOffline && !!(bandId && backingTrackSongIds?.has(song.id));

  return (
    <div className="performance-mode">
      <div className="pm-topbar">
        <button className="pm-icon-btn" onClick={onClose} aria-label="Close performance mode">✕</button>
        <div className="pm-topbar__title">
          <span className="pm-topbar__song">{song.title}</span>
          {song.artist && <span className="pm-topbar__artist"> — {song.artist}</span>}
        </div>
        <button className="pm-icon-btn" onClick={() => setShowDrawer(true)} aria-label="Song list">☰</button>
      </div>

      <div className="pm-meta">
        {song._setName && <span className="pm-meta__set">{song._setName}</span>}
        {song.original_key && <span className="pm-meta__key">Key {song.original_key}</span>}
        {song.bpm && <span className="pm-meta__bpm">{song.bpm} BPM</span>}
        <span className="pm-meta__position">{currentIndex + 1} / {songs.length}</span>
      </div>

      <div
        className="pm-lyrics"
        style={{ '--pm-font-scale': FONT_SCALES[fontIndex].scale }}
        ref={lyricsRef}
        onTouchStart={() => { if (autoscrollPlaying) setAutoscrollPlaying(false); }}
      >
        <PerformanceLyrics text={song.lyrics} />

        <button
          type="button"
          className="pm-tap-zone pm-tap-zone--left"
          onClick={goPrev}
          disabled={currentIndex === 0}
          aria-label="Previous song"
        >
          ‹
        </button>
        <button
          type="button"
          className="pm-tap-zone pm-tap-zone--right"
          onClick={goNext}
          disabled={currentIndex === songs.length - 1}
          aria-label="Next song"
        >
          ›
        </button>
      </div>

      <div className="pm-controls">
        <div className="pm-controls__group">
          <button className="pm-chip" onClick={() => setFontIndex((i) => Math.max(0, i - 1))} disabled={fontIndex === 0}>A−</button>
          <span className="pm-chip pm-chip--label">{FONT_SCALES[fontIndex].label}</span>
          <button className="pm-chip" onClick={() => setFontIndex((i) => Math.min(FONT_SCALES.length - 1, i + 1))} disabled={fontIndex === FONT_SCALES.length - 1}>A+</button>
        </div>

        <div className="pm-controls__group">
          <button className="pm-chip" onClick={() => setAutoscrollPlaying((p) => !p)}>
            {autoscrollPlaying ? '⏸' : '▶'} Scroll
          </button>
          <button className="pm-chip" onClick={() => setAutoscrollSeconds((s) => Math.max(MIN_AUTOSCROLL_SECONDS, s - AUTOSCROLL_STEP_SECONDS))} disabled={autoscrollSeconds <= MIN_AUTOSCROLL_SECONDS}>−30s</button>
          <span className="pm-chip pm-chip--label">{formatDuration(autoscrollSeconds)}</span>
          <button className="pm-chip" onClick={() => setAutoscrollSeconds((s) => Math.min(MAX_AUTOSCROLL_SECONDS, s + AUTOSCROLL_STEP_SECONDS))} disabled={autoscrollSeconds >= MAX_AUTOSCROLL_SECONDS}>+30s</button>
        </div>

        {(canListen || hasBackingTrack) && (
          <div className="pm-controls__group">
            {canListen && (
              <button className="pm-chip" onClick={() => setShowListen((v) => !v)}>{showListen ? 'Hide' : 'Listen'}</button>
            )}
            {hasBackingTrack && (
              <button className="pm-chip" onClick={() => setShowTrack((v) => !v)}>{showTrack ? 'Hide' : 'Backing track'}</button>
            )}
          </div>
        )}
      </div>

      {showListen && canListen && (
        <div className="pm-panel">
          <ReferencePlayer url={song.reference_url} />
        </div>
      )}
      {showTrack && hasBackingTrack && (
        <div className="pm-panel">
          <BackingTrackPlayer band={{ id: bandId }} song={song} gigId={gigId} />
        </div>
      )}

      {showDrawer && (
        <div className="pm-drawer-overlay" onClick={() => setShowDrawer(false)}>
          <div className="pm-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="pm-drawer__header">
              <span>Setlist</span>
              <button className="pm-icon-btn" onClick={() => setShowDrawer(false)} aria-label="Close song list">✕</button>
            </div>
            <ul className="pm-drawer__list">
              {songs.map((s, i) => {
                const showSetHeader = i === 0 || s._setName !== songs[i - 1]._setName;
                return (
                  <li key={s.id + '-' + i}>
                    {showSetHeader && s._setName && <div className="pm-drawer__set-header">{s._setName}</div>}
                    <button
                      className={'pm-drawer__item' + (i === currentIndex ? ' pm-drawer__item--active' : '')}
                      onClick={() => { setCurrentIndex(i); setShowDrawer(false); }}
                    >
                      <span className="pm-drawer__num">{i + 1}</span>
                      <span className="pm-drawer__title">{s.title}</span>
                      {s.artist && <span className="pm-drawer__artist">{s.artist}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

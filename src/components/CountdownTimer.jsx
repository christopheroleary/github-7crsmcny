import { useEffect, useRef, useState } from 'react';

const PRESET_MINUTES = [5, 10, 15, 20, 30, 45, 60];
const DEFAULT_MS = 5 * 60 * 1000;
const MAX_MS = 999 * 60 * 1000; // sanity cap, not a real limit anyone will hit

function clampMs(ms) {
  return Math.max(0, Math.min(MAX_MS, ms));
}

function msToParts(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  return { minutes: Math.floor(totalSeconds / 60), seconds: totalSeconds % 60 };
}

function formatMs(ms) {
  const { minutes, seconds } = msToParts(ms);
  return String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
}

// Plain count-down-to-zero timer -- a set length, a break, time to
// doors. No network calls anywhere here, so it works offline like the
// other Tools.
//
// Counts down from a real wall-clock end time (Date.now() + remaining),
// recomputed on every tick, rather than just decrementing a fixed step
// each time the interval fires -- a backgrounded tab (where browsers
// throttle timers, sometimes to once a minute) would otherwise drift
// well behind the real elapsed time; computing from the wall clock
// self-corrects to the true remaining time the moment it's next checked,
// however late that check actually runs.
export default function CountdownTimer() {
  const [totalMs, setTotalMs] = useState(DEFAULT_MS);
  const [remainingMs, setRemainingMs] = useState(DEFAULT_MS);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);

  const targetEndRef = useRef(null);
  const intervalIdRef = useRef(null);
  const audioCtxRef = useRef(null);

  // Release audio resources if this tab is left mid-countdown. stop()
  // only reads refs, so the first render's closure is safe to reuse.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => stop, []);

  function ensureAudio() {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      audioCtxRef.current = new AudioCtx();
    }
    return audioCtxRef.current;
  }

  // Primed on Start (a real user gesture) even though it isn't needed
  // until the countdown actually reaches zero, possibly minutes later --
  // once an AudioContext has been resumed by a gesture once, it can keep
  // playing sounds without a fresh one, so the alert doesn't need its own
  // click to unlock audio right as the countdown ends.
  function playAlert() {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    [0, 0.18, 0.36].forEach((offset) => {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 1200;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.5, ctx.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + 0.16);
    });
  }

  function finish() {
    if (intervalIdRef.current) clearInterval(intervalIdRef.current);
    intervalIdRef.current = null;
    setRemainingMs(0);
    setRunning(false);
    setFinished(true);
    playAlert();
  }

  function tick() {
    const remaining = targetEndRef.current - Date.now();
    if (remaining <= 0) { finish(); return; }
    setRemainingMs(remaining);
  }

  async function start() {
    if (totalMs <= 0) return;
    const ctx = ensureAudio();
    if (ctx.state === 'suspended') await ctx.resume();
    const startFrom = finished ? totalMs : remainingMs;
    setFinished(false);
    setRemainingMs(startFrom);
    targetEndRef.current = Date.now() + startFrom;
    intervalIdRef.current = setInterval(tick, 200);
    setRunning(true);
  }

  function pause() {
    if (intervalIdRef.current) clearInterval(intervalIdRef.current);
    intervalIdRef.current = null;
    setRemainingMs(Math.max(0, targetEndRef.current - Date.now()));
    setRunning(false);
  }

  function reset() {
    if (intervalIdRef.current) clearInterval(intervalIdRef.current);
    intervalIdRef.current = null;
    setRunning(false);
    setFinished(false);
    setRemainingMs(totalMs);
  }

  function stop() {
    if (intervalIdRef.current) clearInterval(intervalIdRef.current);
    intervalIdRef.current = null;
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close().catch(() => {});
    }
    audioCtxRef.current = null;
  }

  function applyPreset(mins) {
    const ms = mins * 60000;
    setTotalMs(ms);
    setRemainingMs(ms);
    setFinished(false);
  }

  const { minutes, seconds } = msToParts(remainingMs);

  function handleMinutesChange(e) {
    const value = Math.max(0, Math.min(999, Math.floor(Number(e.target.value)) || 0));
    const ms = clampMs(value * 60000 + seconds * 1000);
    setTotalMs(ms);
    setRemainingMs(ms);
    setFinished(false);
  }

  function handleSecondsChange(e) {
    const value = Math.max(0, Math.min(59, Math.floor(Number(e.target.value)) || 0));
    const ms = clampMs(minutes * 60000 + value * 1000);
    setTotalMs(ms);
    setRemainingMs(ms);
    setFinished(false);
  }

  return (
    <div className="day-sheet__section">
      <h3 className="day-sheet__section-title">Countdown timer</h3>
      <p className="field__hint" style={{ marginBottom: 12 }}>
        Track a set length, a break, or time to doors.
      </p>

      <div
        className={
          'countdown-display' +
          (finished ? ' countdown-display--finished' : running ? ' countdown-display--running' : '')
        }
      >
        {formatMs(remainingMs)}
      </div>

      {!running && (
        <div className="countdown-inputs">
          <label className="field countdown-inputs__field">
            <span className="field__label">Min</span>
            <input type="number" min="0" max="999" value={minutes} onChange={handleMinutesChange} />
          </label>
          <label className="field countdown-inputs__field">
            <span className="field__label">Sec</span>
            <input type="number" min="0" max="59" value={seconds} onChange={handleSecondsChange} />
          </label>
        </div>
      )}

      <div className="tuner-strings" style={{ marginTop: 12, marginBottom: 16 }}>
        {PRESET_MINUTES.map((m) => (
          <button
            key={m}
            type="button"
            className={'tuner-string tuner-string--btn' + (totalMs === m * 60000 ? ' tuner-string--active' : '')}
            onClick={() => applyPreset(m)}
            disabled={running}
          >
            {m}m
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {running ? (
          <button className="btn btn--ghost" onClick={pause}>
            Pause
          </button>
        ) : (
          <button className="btn btn--primary" onClick={start} disabled={totalMs <= 0}>
            {finished ? 'Restart countdown' : remainingMs === totalMs ? 'Start countdown' : 'Resume countdown'}
          </button>
        )}
        <button className="btn btn--ghost btn--small" style={{ width: 'auto', alignSelf: 'flex-start' }} onClick={reset}>
          Reset
        </button>
      </div>
    </div>
  );
}

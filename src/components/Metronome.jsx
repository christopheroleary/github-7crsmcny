import { useEffect, useRef, useState } from 'react';

const MIN_BPM = 30;
const MAX_BPM = 300;
const DEFAULT_BPM = 120;

// How far ahead (seconds) beats get scheduled, and how often (ms) the
// scheduler wakes up to top that window back up. This is the standard
// "look-ahead scheduler" pattern for Web Audio timing (see Chris Wilson's
// "A Tale of Two Clocks") -- a plain setInterval per beat drifts and
// jitters under normal JS timer imprecision (worse the moment the tab is
// backgrounded), which is exactly what a drummer using this as a real
// click on a gig can't afford. Scheduling beats on the audio hardware's
// own clock (ctx.currentTime), well ahead of when they actually need to
// sound, keeps playback sample-accurate regardless of how late or jittery
// the JS timer that requests each batch of scheduling actually runs.
const SCHEDULE_AHEAD_S = 0.1;
const LOOKAHEAD_MS = 25;

const SOUNDS = [
  { id: 'click', label: 'Click' },
  { id: 'beep', label: 'Beep' },
  { id: 'wood', label: 'Wood block' },
  { id: 'cowbell', label: 'Cowbell' },
];

// Every sound is synthesised, not a loaded sample -- no audio file to
// fetch (or fail to fetch with no signal), and no bundle weight either.
function playClick(ctx, time) {
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.value = 1800;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.7, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.03);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(time);
  osc.stop(time + 0.04);
}

function playBeep(ctx, time) {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 1000;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.6, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.08);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(time);
  osc.stop(time + 0.09);
}

function playWood(ctx, time) {
  // A short burst of filtered noise reads as a "knock" rather than a
  // tone -- an oscillator can't produce that percussive, pitchless
  // quality on its own.
  const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * 0.05));
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const bandpass = ctx.createBiquadFilter();
  bandpass.type = 'bandpass';
  bandpass.frequency.value = 1800;
  bandpass.Q.value = 2.5;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.8, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
  noise.connect(bandpass);
  bandpass.connect(gain);
  gain.connect(ctx.destination);
  noise.start(time);
  noise.stop(time + 0.06);
}

function playCowbell(ctx, time) {
  // Classic two-square-oscillators-through-a-bandpass-filter cowbell --
  // the same recipe behind the 808's cowbell, chosen for being instantly
  // recognisable and cutting through a full band mix.
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.4, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.25);
  const bandpass = ctx.createBiquadFilter();
  bandpass.type = 'bandpass';
  bandpass.frequency.value = 800;
  bandpass.Q.value = 1;
  bandpass.connect(gain);
  gain.connect(ctx.destination);
  [800, 540].forEach((freq) => {
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;
    osc.connect(bandpass);
    osc.start(time);
    osc.stop(time + 0.25);
  });
}

const PLAYERS = { click: playClick, beep: playBeep, wood: playWood, cowbell: playCowbell };

// A deliberately plain, no-accent click -- every beat is identical, no
// downbeat emphasis, no time signature or subdivisions -- so it's
// something a drummer can start in seconds as an emergency click if a
// gig's own click track isn't available, not a full practice-metronome
// feature set to learn under pressure.
export default function Metronome() {
  const [bpm, setBpm] = useState(DEFAULT_BPM);
  const [bpmText, setBpmText] = useState(String(DEFAULT_BPM));
  const [playing, setPlaying] = useState(false);
  const [sound, setSound] = useState('click');

  const bpmRef = useRef(bpm);
  const soundRef = useRef(sound);
  const audioCtxRef = useRef(null);
  const schedulerIdRef = useRef(null);
  const nextNoteTimeRef = useRef(0);
  const beatQueueRef = useRef([]);
  const pulseRafRef = useRef(null);
  const pulseDotRef = useRef(null);

  useEffect(() => { bpmRef.current = bpm; }, [bpm]);
  useEffect(() => { soundRef.current = sound; }, [sound]);

  // Stop cleanly if this tab is left mid-click. stop() only reads refs and
  // stable setters, so the first render's closure is safe to reuse.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => stop, []);

  function flashBeat() {
    const dot = pulseDotRef.current;
    if (!dot) return;
    // Forcing a reflow between removing and re-adding the class restarts
    // the CSS animation on every beat -- without it, back-to-back beats
    // faster than the animation's own duration wouldn't re-trigger it.
    dot.classList.remove('metronome-pulse--flash');
    void dot.offsetWidth;
    dot.classList.add('metronome-pulse--flash');
  }

  function visualLoop() {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    while (beatQueueRef.current.length && beatQueueRef.current[0] <= ctx.currentTime) {
      beatQueueRef.current.shift();
      flashBeat();
    }
    pulseRafRef.current = requestAnimationFrame(visualLoop);
  }

  function scheduler() {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    while (nextNoteTimeRef.current < ctx.currentTime + SCHEDULE_AHEAD_S) {
      const player = PLAYERS[soundRef.current] || playClick;
      player(ctx, nextNoteTimeRef.current);
      beatQueueRef.current.push(nextNoteTimeRef.current);
      nextNoteTimeRef.current += 60 / bpmRef.current;
    }
  }

  async function start() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    audioCtxRef.current = ctx;
    if (ctx.state === 'suspended') await ctx.resume();
    nextNoteTimeRef.current = ctx.currentTime + 0.05;
    beatQueueRef.current = [];
    schedulerIdRef.current = setInterval(scheduler, LOOKAHEAD_MS);
    pulseRafRef.current = requestAnimationFrame(visualLoop);
    setPlaying(true);
  }

  function stop() {
    if (schedulerIdRef.current) clearInterval(schedulerIdRef.current);
    schedulerIdRef.current = null;
    if (pulseRafRef.current) cancelAnimationFrame(pulseRafRef.current);
    pulseRafRef.current = null;
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close().catch(() => {});
    }
    audioCtxRef.current = null;
    beatQueueRef.current = [];
    setPlaying(false);
  }

  function toggle() {
    if (playing) stop();
    else start();
  }

  function clampBpm(value) {
    return Math.min(MAX_BPM, Math.max(MIN_BPM, value));
  }

  function handleSliderChange(e) {
    const value = Number(e.target.value);
    setBpm(value);
    setBpmText(String(value));
  }

  // Free typing is allowed to pass through as-is (including a fractional
  // value someone actually wants, e.g. 127.5) -- only clamped/applied
  // once it parses to a real, positive number, so mid-type states like
  // "" or "1" don't fight the field or reset it back to 120.
  function handleBpmTextChange(e) {
    const value = e.target.value;
    setBpmText(value);
    const parsed = Number(value);
    if (value.trim() !== '' && Number.isFinite(parsed) && parsed > 0) {
      setBpm(clampBpm(parsed));
    }
  }

  function handleBpmBlur() {
    setBpmText(String(bpm));
  }

  return (
    <div className="day-sheet__section">
      <h3 className="day-sheet__section-title">Metronome</h3>
      <p className="field__hint" style={{ marginBottom: 12 }}>
        A plain click, no accent -- for a drummer who needs an emergency click track on the fly.
      </p>

      <div className="metronome-bpm-row">
        <input
          type="number"
          className="metronome-bpm-input"
          value={bpmText}
          onChange={handleBpmTextChange}
          onBlur={handleBpmBlur}
          min={MIN_BPM}
          max={MAX_BPM}
          step="0.1"
          aria-label="Beats per minute"
        />
        <span className="metronome-bpm-label">BPM</span>
        <span className="metronome-pulse" ref={pulseDotRef} aria-hidden="true" />
      </div>

      <input
        type="range"
        className="metronome-slider"
        min={MIN_BPM}
        max={MAX_BPM}
        step={1}
        value={Math.round(bpm)}
        onChange={handleSliderChange}
        aria-label="Tempo slider"
      />

      <div className="tuner-strings" style={{ marginTop: 14, marginBottom: 16 }}>
        {SOUNDS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={'tuner-string tuner-string--btn' + (sound === s.id ? ' tuner-string--active' : '')}
            onClick={() => setSound(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <button className={'btn btn--small ' + (playing ? 'btn--ghost' : 'btn--primary')} onClick={toggle}>
        {playing ? '■ Stop' : '▶ Start metronome'}
      </button>
    </div>
  );
}

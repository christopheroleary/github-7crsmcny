import { useEffect, useRef, useState } from 'react';

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

// Standard guitar tuning, low string to high -- MIDI note numbers (A4 =
// note 69 = 440Hz, the same reference autoCorrelate's caller uses below).
const GUITAR_STRINGS = [
  { note: 40, label: 'E2' },
  { note: 45, label: 'A2' },
  { note: 50, label: 'D3' },
  { note: 55, label: 'G3' },
  { note: 59, label: 'B3' },
  { note: 64, label: 'E4' },
];

const IN_TUNE_CENTS = 5;

function frequencyFromNote(note) {
  return 440 * Math.pow(2, (note - 69) / 12);
}

function noteNameFromMidi(note) {
  return { name: NOTE_NAMES[((note % 12) + 12) % 12], octave: Math.floor(note / 12) - 1 };
}

// Autocorrelation pitch detector (the "ACF2+" approach) -- a standard,
// well-tested way to track a single monophonic pitch from a time-domain
// buffer in real time; follows the same shape as Chris Wilson's widely
// used pitch-detection demo. FFT-based approaches need a much bigger
// window to resolve a low guitar E string's ~82Hz accurately; this reads
// the period directly off the waveform instead.
function autoCorrelate(buf, sampleRate) {
  const SIZE = buf.length;
  let rms = 0;
  for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.01) return -1; // too quiet -- treat as no note playing

  // Trim near-silent lead-in/tail so the correlation isn't diluted by
  // silence at the edges of the window.
  let r1 = 0, r2 = SIZE - 1;
  const threshold = 0.2;
  for (let i = 0; i < SIZE / 2; i++) { if (Math.abs(buf[i]) < threshold) { r1 = i; break; } }
  for (let i = 1; i < SIZE / 2; i++) { if (Math.abs(buf[SIZE - i]) < threshold) { r2 = SIZE - i; break; } }
  const trimmed = buf.slice(r1, r2);
  const n = trimmed.length;

  const c = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n - i; j++) c[i] += trimmed[j] * trimmed[j + i];
  }

  let d = 0;
  while (d + 1 < n && c[d] > c[d + 1]) d++;
  let maxVal = -1, maxPos = -1;
  for (let i = d; i < n; i++) {
    if (c[i] > maxVal) { maxVal = c[i]; maxPos = i; }
  }
  if (maxPos <= 0) return -1;

  // Parabolic interpolation around the peak for sub-sample precision --
  // without this, pitch readings jump in whole-sample steps, which at
  // audio sample rates is easily a few cents of jitter on its own.
  let T0 = maxPos;
  const x1 = c[T0 - 1] ?? 0, x2 = c[T0] ?? 0, x3 = c[T0 + 1] ?? 0;
  const a = (x1 + x3 - 2 * x2) / 2;
  const b = (x3 - x1) / 2;
  if (a) T0 -= b / (2 * a);

  return T0 > 0 ? sampleRate / T0 : -1;
}

// GuitarTuna-style live tuner: a needle that runs continuously left
// (flat) to right (sharp) of centre as pitch is detected, rather than a
// one-shot reading. Needle position and the cents readout are written
// straight to the DOM every animation frame (refs, not state) -- only the
// detected note NAME changes trigger a React re-render, so tuning stays
// smooth at 60fps without re-rendering the whole card that often.
//
// No network calls anywhere in this file, deliberately -- mic capture,
// pitch detection and the reference tone are all local Web Audio API work,
// so this works with no signal at a gig the same as it does online. Keep
// it that way: don't add anything here (an API-based tuning reference, a
// remote sample) that would make it depend on a connection this app
// otherwise assumes it doesn't have.
export default function GuitarTuner() {
  const [status, setStatus] = useState('idle'); // idle | starting | running | error
  const [error, setError] = useState(null);
  const [display, setDisplay] = useState({ name: '—', octave: null, active: false, noteNum: null });

  const needleRef = useRef(null);
  const noteBoxRef = useRef(null);
  const centsTextRef = useRef(null);
  const audioCtxRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const smoothedCentsRef = useRef(0);
  const activeNoteRef = useRef(null);

  // Reference tone -- a held sine note anyone can tune a string against by
  // ear, for whoever can't or won't grant microphone access. Deliberately
  // its own AudioContext/oscillator, entirely separate from the mic-based
  // detector above: no permission needed, and it works whether or not the
  // mic tuner is even running.
  const [toneNote, setToneNote] = useState(GUITAR_STRINGS[0].note);
  const [tonePlaying, setTonePlaying] = useState(false);
  const toneCtxRef = useRef(null);
  const toneOscRef = useRef(null);
  const toneGainRef = useRef(null);

  // Release the mic and silence the reference tone if this tab is left
  // mid-tune. stop()/stopTone() only read refs and stable setters, so the
  // first render's closures are safe to reuse.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => {
    stop();
    stopTone();
    if (toneCtxRef.current && toneCtxRef.current.state !== 'closed') toneCtxRef.current.close().catch(() => {});
  }, []);

  function applyMeter(cents, active, inTune) {
    const clamped = Math.max(-50, Math.min(50, cents));
    const pct = ((clamped + 50) / 100) * 100;
    if (needleRef.current) {
      needleRef.current.style.left = pct + '%';
      needleRef.current.className = 'tuner-needle' + (active ? (inTune ? ' tuner-needle--in-tune' : ' tuner-needle--off') : '');
    }
    if (noteBoxRef.current) {
      noteBoxRef.current.className = 'tuner-note' + (active ? (inTune ? ' tuner-note--in-tune' : ' tuner-note--off') : ' tuner-note--idle');
    }
    if (centsTextRef.current) {
      centsTextRef.current.textContent = active ? (cents > 0 ? '+' : '') + Math.round(cents) + '¢' : '—';
    }
  }

  function handlePitch(freq) {
    if (!freq || freq < 0) {
      // No clear pitch this frame -- ease the needle back to centre
      // instead of snapping it, so a brief dropout between notes doesn't
      // read as a glitch.
      smoothedCentsRef.current *= 0.85;
      const stillMoving = Math.abs(smoothedCentsRef.current) > 0.5;
      applyMeter(smoothedCentsRef.current, stillMoving, false);
      if (!stillMoving && activeNoteRef.current != null) {
        activeNoteRef.current = null;
        setDisplay({ name: '—', octave: null, active: false, noteNum: null });
      }
      return;
    }

    const noteNum = Math.round(12 * Math.log2(freq / 440) + 69);
    const cents = 1200 * Math.log2(freq / frequencyFromNote(noteNum));
    // Light easing rather than plotting the raw value -- a real string's
    // pitch flickers by a couple of cents from vibration alone, and an
    // un-eased needle reads as jittery noise instead of a steady line.
    smoothedCentsRef.current += (cents - smoothedCentsRef.current) * 0.35;
    const inTune = Math.abs(smoothedCentsRef.current) <= IN_TUNE_CENTS;
    applyMeter(smoothedCentsRef.current, true, inTune);

    if (activeNoteRef.current !== noteNum) {
      activeNoteRef.current = noteNum;
      const { name, octave } = noteNameFromMidi(noteNum);
      setDisplay({ name, octave, active: true, noteNum });
    }
  }

  async function start() {
    setError(null);
    setStatus('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // Echo cancellation / noise suppression / auto-gain all reshape
        // the waveform to sound better to a human ear on a call -- exactly
        // the kind of processing that throws off a pitch detector reading
        // the raw waveform's period.
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      streamRef.current = stream;
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioCtxRef.current = audioCtx;
      if (audioCtx.state === 'suspended') await audioCtx.resume();

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);

      const buf = new Float32Array(analyser.fftSize);
      const tick = () => {
        analyser.getFloatTimeDomainData(buf);
        handlePitch(autoCorrelate(buf, audioCtx.sampleRate));
        rafRef.current = requestAnimationFrame(tick);
      };
      setStatus('running');
      rafRef.current = requestAnimationFrame(tick);
    } catch (err) {
      setStatus('error');
      setError(
        err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError'
          ? 'Microphone access was blocked. Allow it for this site in your browser settings, then try again.'
          : err?.name === 'NotFoundError'
          ? 'No microphone was found on this device.'
          : "Couldn't access the microphone: " + (err?.message || 'unknown error')
      );
    }
  }

  function stop() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close().catch(() => {});
    }
    audioCtxRef.current = null;
    activeNoteRef.current = null;
    smoothedCentsRef.current = 0;
    setStatus('idle');
    setDisplay({ name: '—', octave: null, active: false, noteNum: null });
    applyMeter(0, false, false);
  }

  function ensureToneContext() {
    if (!toneCtxRef.current || toneCtxRef.current.state === 'closed') {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      toneCtxRef.current = new AudioCtx();
    }
    return toneCtxRef.current;
  }

  // The reference tone plays an octave above the string's actual pitch --
  // small phone/laptop speakers roll off hard below ~150Hz and can barely
  // reproduce a real low E2 (~82Hz) at all, let alone loud enough to tune
  // by. An octave up is still the same note (and in tune against the same
  // string, an octave apart is a trivially easy interval for most ears to
  // judge), and every speaker this is likely to play through handles it
  // properly. The E2/A2/etc. labels stay as the string's real name --
  // only the actual oscillator frequency shifts.
  function toneFrequency(note) {
    return frequencyFromNote(note + 12);
  }

  function playTone(note) {
    const ctx = ensureToneContext();
    if (ctx.state === 'suspended') ctx.resume();
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = toneFrequency(note);
    const gain = ctx.createGain();
    // Ramped, not a hard on/off -- starting or stopping a sine wave
    // instantly produces an audible click/pop.
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.4, ctx.currentTime + 0.03);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    toneOscRef.current = osc;
    toneGainRef.current = gain;
    setTonePlaying(true);
  }

  function retuneTone(note) {
    const ctx = toneCtxRef.current;
    if (!ctx || !toneOscRef.current) return;
    // A quick glide rather than an instant jump -- still effectively
    // immediate for tuning purposes, but avoids a harsh step in the tone.
    toneOscRef.current.frequency.setTargetAtTime(toneFrequency(note), ctx.currentTime, 0.03);
  }

  function stopTone() {
    const ctx = toneCtxRef.current;
    const osc = toneOscRef.current;
    const gain = toneGainRef.current;
    if (ctx && osc && gain) {
      gain.gain.cancelScheduledValues(ctx.currentTime);
      gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.03);
      osc.stop(ctx.currentTime + 0.04);
    }
    // An OscillatorNode can only ever be started once -- stopTone()
    // always discards it, and playTone() always creates a fresh one.
    toneOscRef.current = null;
    toneGainRef.current = null;
    setTonePlaying(false);
  }

  function toggleTone() {
    if (tonePlaying) stopTone();
    else playTone(toneNote);
  }

  function selectToneNote(note) {
    setToneNote(note);
    if (tonePlaying) retuneTone(note);
  }

  const micUnsupported = !navigator.mediaDevices?.getUserMedia;

  return (
    <div className="day-sheet__section">
      <h3 className="day-sheet__section-title">Guitar tuner</h3>

      {micUnsupported ? (
        <p className="form-error">This browser doesn't support microphone access, so the mic tuner can't run here — use the reference tone below instead.</p>
      ) : status === 'idle' || status === 'starting' || status === 'error' ? (
        <>
          <p className="field__hint" style={{ marginBottom: 12 }}>
            Play a string and this'll show how flat or sharp it is — needle left is flat, right is sharp.
          </p>
          {error && <p className="form-error" style={{ marginBottom: 12 }}>{error}</p>}
          <button className="btn btn--primary btn--small" onClick={start} disabled={status === 'starting'}>
            {status === 'starting' ? 'Requesting microphone…' : '🎙 Start tuner'}
          </button>
        </>
      ) : (
        <>
          <div className="tuner-readout">
            <div className="tuner-note tuner-note--idle" ref={noteBoxRef}>
              <span className="tuner-note__name">{display.name}</span>
              {display.octave != null && <span className="tuner-note__octave">{display.octave}</span>}
            </div>
            <span className="tuner-cents" ref={centsTextRef}>—</span>
          </div>

          <div className="tuner-meter">
            <span className="tuner-meter__label tuner-meter__label--flat">FLAT</span>
            <div className="tuner-meter__track">
              <div className="tuner-meter__zone" />
              {[-50, -25, 0, 25, 50].map((tick) => (
                <span key={tick} className="tuner-meter__tick" style={{ left: ((tick + 50) / 100) * 100 + '%' }} />
              ))}
              <div className="tuner-needle" ref={needleRef} style={{ left: '50%' }} />
            </div>
            <span className="tuner-meter__label tuner-meter__label--sharp">SHARP</span>
          </div>

          <div className="tuner-strings">
            {GUITAR_STRINGS.map((s) => (
              <span key={s.label} className={'tuner-string' + (display.noteNum === s.note ? ' tuner-string--active' : '')}>
                {s.label}
              </span>
            ))}
          </div>

          <button className="btn btn--ghost btn--small" style={{ marginTop: 12 }} onClick={stop}>
            Stop tuner
          </button>
        </>
      )}

      {/* Always available, mic or no mic -- a held reference note to tune
          a string against by ear, for anyone who can't or won't grant
          microphone access. */}
      <div className="tuner-tone">
        <p className="field__hint" style={{ marginBottom: 10 }}>
          Can't use the mic? Play a reference note and tune by ear instead.
        </p>
        <div className="tuner-tone__row">
          <button
            type="button"
            className={'btn btn--small tuner-tone__toggle' + (tonePlaying ? ' btn--primary' : ' btn--ghost')}
            onClick={toggleTone}
            aria-label={tonePlaying ? 'Stop reference tone' : 'Play reference tone'}
            title={tonePlaying ? 'Stop reference tone' : 'Play reference tone'}
          >
            {tonePlaying ? '🔊' : '🔈'}
          </button>
          <div className="tuner-strings">
            {GUITAR_STRINGS.map((s) => (
              <button
                key={s.label}
                type="button"
                className={'tuner-string tuner-string--btn' + (toneNote === s.note ? ' tuner-string--active' : '')}
                onClick={() => selectToneNote(s.note)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

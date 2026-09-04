import { useEffect, useRef, useState } from 'react';
import { getDeviceInfo } from '../utils/deviceInfo.js';

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

// Only lags corresponding to this musical range are ever considered --
// well below a low E2 (~82Hz) and well above a high E4 (~330Hz), with
// margin either way for the reference tone / a slightly detuned string.
// Bounding the search range this way both rules out degenerate
// near-zero-lag matches (any smooth waveform trivially "correlates with
// itself" one sample later) and cuts the correlation's own cost
// substantially versus searching the entire buffer.
const MIN_FREQ = 60;
const MAX_FREQ = 1500;

// Minimum NSDF "clarity" to trust a reading at all -- see nsdf() below.
// Empirically verified (synthetic clean + harmonic-rich test tones,
// plus tones with added noise at various levels): a genuinely clean
// signal reads ~1.0 regardless of frequency, dropping smoothly as noise
// is added, and the frequency estimate itself only starts actually going
// wrong once clarity falls below roughly 0.8 -- 0.85 leaves a safety
// margin on the correct side of that line without being so strict it
// rejects an ordinary, slightly-imperfect real-world signal.
const MIN_CLARITY = 0.85;

// Normalised Square Difference Function (McLeod & Wyvill's "A Smarter
// Way to Find Pitch") -- for each lag, 2 * autocorrelation / total
// energy of the two overlapping windows at that lag. A *plain*
// autocorrelation sum isn't normalised for how many samples overlap at
// each lag (a short lag has more overlapping terms than a long one),
// which systematically inflates short-lag (high-frequency) values for
// any signal with broadband/noise content -- exactly what let a noisy
// frame lock onto a spurious high-frequency "peak" before. NSDF divides
// that bias out, giving a value in [-1, 1] that's directly comparable
// across every lag and, for a genuinely periodic signal, sits at ~1.0 at
// the true period regardless of how low or high that frequency is.
function nsdf(buf, maxLag) {
  const n = buf.length;
  const result = new Float32Array(maxLag + 1);
  for (let lag = 0; lag <= maxLag; lag++) {
    let acf = 0, energy = 0;
    const limit = n - lag;
    for (let j = 0; j < limit; j++) {
      acf += buf[j] * buf[j + lag];
      energy += buf[j] * buf[j] + buf[j + lag] * buf[j + lag];
    }
    result[lag] = energy > 0 ? (2 * acf) / energy : 0;
  }
  return result;
}

// Picks the EARLIEST strong peak, not just the single tallest value
// anywhere in range -- a real (or even a perfectly clean synthetic)
// periodic tone scores ~1.0 not only at its true period but also at
// every integer multiple of it (a wave shifted by 2/3/4x its own period
// still lines up with itself), so a plain "take the tallest" search is
// a coin flip between the true pitch and a spurious octave-down (or
// further) reading -- confirmed live: an unbiased tallest-peak search
// mis-picked the octave on several of the six standard string
// frequencies for a perfectly clean test tone. Preferring the first peak
// that comes within 90% of the best one found resolves that tie toward
// the true (shorter, higher-frequency) fundamental instead.
function pickPeak(nsd, from) {
  const peaks = [];
  for (let i = Math.max(from, 1); i < nsd.length - 1; i++) {
    if (nsd[i] >= nsd[i - 1] && nsd[i] >= nsd[i + 1] && nsd[i] > 0) peaks.push(i);
  }
  if (peaks.length === 0) return -1;
  const highest = Math.max(...peaks.map((i) => nsd[i]));
  const threshold = highest * 0.9;
  return peaks.find((i) => nsd[i] >= threshold) ?? peaks[0];
}

function autoCorrelate(buf, sampleRate) {
  const SIZE = buf.length;
  let rms = 0;
  for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / SIZE);
  // A cheap early-exit for true silence, not the real noise guard --
  // that's the NSDF clarity threshold below, which works at any signal
  // level since it's normalised, not tied to absolute amplitude. This
  // only needs to sit safely under "however quiet a genuine, usable
  // signal can get". Confirmed live: 0.01 was too high a floor on an
  // iPhone -- with autoGainControl deliberately off (needed for an
  // undistorted waveform to read the period from), iOS's mic gain
  // staging produced noticeably quieter raw samples than a laptop or
  // Android phone did for the same input volume, so every single frame
  // was silently discarded before pitch detection ever ran, showing "--"
  // with no error and no obvious cause.
  if (rms < 0.0015) return -1; // too quiet -- treat as no note playing

  const minLag = Math.floor(sampleRate / MAX_FREQ);
  const maxLag = Math.min(SIZE - 1, Math.ceil(sampleRate / MIN_FREQ));
  const nsd = nsdf(buf, maxLag);

  // Skip past NSDF's initial descent from lag 0 (trivially near 1.0 for
  // any smooth waveform, periodic or not) before peak-picking begins.
  let d = 0;
  while (d + 1 < nsd.length && nsd[d] > nsd[d + 1]) d++;
  d = Math.max(d, minLag);

  const maxPos = pickPeak(nsd, d);
  if (maxPos <= 0) return -1;
  if (nsd[maxPos] < MIN_CLARITY) return -1;

  // Parabolic interpolation around the peak for sub-sample precision --
  // without this, pitch readings jump in whole-sample steps, which at
  // audio sample rates is easily a few cents of jitter on its own.
  let T0 = maxPos;
  const x1 = nsd[T0 - 1] ?? 0, x2 = nsd[T0] ?? 0, x3 = nsd[T0 + 1] ?? 0;
  const a = (x1 + x3 - 2 * x2) / 2;
  const b = (x3 - x1) / 2;
  if (a) T0 -= b / (2 * a);

  return T0 > 0 ? sampleRate / T0 : -1;
}

function median3(values) {
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.floor(sorted.length / 2)];
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
  // Distinct from `error` (a failed start()) -- this fires once running,
  // when the mic stream never produces even background-noise-level
  // signal at all. Seen specifically on some iPhones opened from the
  // home-screen icon: the permission prompt appears, the mic indicator
  // shows active, but no audio data ever actually arrives -- a known
  // class of iOS/WebKit PWA audio-session bug, not something a retry
  // inside this component can force to work, so this just surfaces it
  // plainly instead of leaving the reading stuck at "--" with no
  // explanation.
  const [silenceWarning, setSilenceWarning] = useState(false);
  // iOS Safari doesn't reliably remember a granted mic permission for a
  // home-screen-installed PWA the way it does for a regular tab or for
  // other browsers/OSes -- a known, longstanding WebKit limitation, not
  // something fixable from here. Flagging it up front on affected
  // devices only, so being asked again isn't a surprise or read as this
  // page being broken.
  const [isIosPwa] = useState(() => {
    const { os, isPwa } = getDeviceInfo();
    return isPwa && (os === 'iOS' || os === 'iPadOS');
  });

  const needleRef = useRef(null);
  const noteBoxRef = useRef(null);
  const centsTextRef = useRef(null);
  const audioCtxRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const smoothedCentsRef = useRef(0);
  const activeNoteRef = useRef(null);
  const freqHistoryRef = useRef([]);
  const heardAnySoundRef = useRef(false);
  const silenceCheckIdRef = useRef(null);

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
      // A dropped frame doesn't necessarily mean the note stopped -- a
      // single ambiguous frame is now rejected outright by autoCorrelate's
      // own clarity check rather than reported as a bad reading, so this
      // path fires more often than before on a perfectly good, sustained
      // note. Clearing the median-filter history here (rather than only
      // on a real gap) means the very next good frame after one rejected
      // one isn't still being averaged against an old reading from a
      // different moment.
      freqHistoryRef.current = [];
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

    // A 3-reading median rather than the raw value -- autocorrelation
    // occasionally locks onto a harmonic (an octave error) for a single
    // frame even when otherwise confident; a lone outlier like that gets
    // outvoted by the two surrounding good readings here, before it ever
    // reaches the needle, rather than showing up as a visible flinch that
    // the smoothing below can only partially hide.
    freqHistoryRef.current.push(freq);
    if (freqHistoryRef.current.length > 3) freqHistoryRef.current.shift();
    const medianFreq = freqHistoryRef.current.length === 3 ? median3(freqHistoryRef.current) : freq;

    const noteNum = Math.round(12 * Math.log2(medianFreq / 440) + 69);
    const cents = 1200 * Math.log2(medianFreq / frequencyFromNote(noteNum));
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
    setSilenceWarning(false);
    setStatus('starting');
    heardAnySoundRef.current = false;
    freqHistoryRef.current = [];
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioCtxRef.current = audioCtx;
      // Resumed here, before getUserMedia's permission prompt -- which
      // can sit waiting on the user for any length of time -- rather
      // than after it. iOS Safari ties unlocking audio to a direct user
      // gesture, and by the time an awaited getUserMedia() call actually
      // resolves (once someone's tapped Allow), that gesture window can
      // already have closed; resuming first, while still inside the
      // click handler's own call stack, is the standard workaround.
      if (audioCtx.state === 'suspended') await audioCtx.resume();

      const stream = await navigator.mediaDevices.getUserMedia({
        // Echo cancellation / noise suppression / auto-gain all reshape
        // the waveform to sound better to a human ear on a call -- exactly
        // the kind of processing that throws off a pitch detector reading
        // the raw waveform's period.
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      streamRef.current = stream;

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);

      const buf = new Float32Array(analyser.fftSize);
      const tick = () => {
        analyser.getFloatTimeDomainData(buf);
        // Tracked separately from autoCorrelate's own verdict -- this is
        // a much lower bar (any signal at all, even just background
        // noise) purely to tell "the mic is capturing nothing whatsoever"
        // apart from "it's capturing fine, nobody's played a note yet".
        let maxAbs = 0;
        for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > maxAbs) maxAbs = a; }
        if (maxAbs > 0.003) {
          heardAnySoundRef.current = true;
          setSilenceWarning(false); // no-op if it was already false
        }
        handlePitch(autoCorrelate(buf, audioCtx.sampleRate));
        rafRef.current = requestAnimationFrame(tick);
      };
      setStatus('running');
      rafRef.current = requestAnimationFrame(tick);

      // Seen specifically on some iPhones opened from the home-screen
      // icon: permission granted, the mic indicator shows active, but no
      // audio data ever actually arrives -- a known class of iOS/WebKit
      // PWA audio-session bug this component can't force its way around.
      // Surfacing it explicitly beats leaving the reading silently stuck
      // at "--" with no explanation.
      silenceCheckIdRef.current = setTimeout(() => {
        if (!heardAnySoundRef.current) setSilenceWarning(true);
      }, 4000);
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
    if (silenceCheckIdRef.current) clearTimeout(silenceCheckIdRef.current);
    silenceCheckIdRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close().catch(() => {});
    }
    audioCtxRef.current = null;
    activeNoteRef.current = null;
    smoothedCentsRef.current = 0;
    freqHistoryRef.current = [];
    setStatus('idle');
    setSilenceWarning(false);
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
          {isIosPwa && (
            <p className="field__hint" style={{ marginBottom: 12 }}>
              On an iPhone/iPad opened from the home screen, iOS can ask for microphone permission again
              each time you reopen the app — a known iOS limitation, not something wrong here. Just allow
              it again if asked.
            </p>
          )}
          {error && <p className="form-error" style={{ marginBottom: 12 }}>{error}</p>}
          <button className="btn btn--primary btn--small" onClick={start} disabled={status === 'starting'}>
            {status === 'starting' ? 'Requesting microphone…' : '🎙 Start tuner'}
          </button>
        </>
      ) : (
        <>
          {silenceWarning && (
            <p className="form-error" style={{ marginBottom: 12 }}>
              Not picking up any sound, even background noise — on some phones (an iPhone opened from its
              home-screen icon, especially) the microphone can show as active without actually capturing
              anything. Try closing this page and reopening it, or check microphone access for this site in
              your phone's Settings.
            </p>
          )}

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

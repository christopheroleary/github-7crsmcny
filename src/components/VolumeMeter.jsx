import { useEffect, useRef, useState } from 'react';

// Below this, the fill reads as green ("fine"); between the two, amber
// ("getting loud"); at or above the top one, red ("risking clipping /
// too loud for the room"). Same relative-level idea a mixing desk's
// meters use, not calibrated SPL values.
const AMBER_DB = -12;
const RED_DB = -3;
const FLOOR_DB = -60; // effectively silent -- bottom of the meter

function rmsToDb(rms) {
  if (rms <= 0) return FLOOR_DB;
  return Math.max(FLOOR_DB, 20 * Math.log10(rms));
}

function dbToPercent(db) {
  return ((db - FLOOR_DB) / -FLOOR_DB) * 100;
}

// A-weighting: shapes the meter's response to roughly match how loud
// human hearing actually perceives a given frequency (we're far less
// sensitive to deep bass and very high treble than to the 1-4kHz range
// most speech/vocals sit in), the same weighting curve a real dB(A)
// reading uses. Doesn't turn this into a calibrated SPL meter -- there's
// still no reference to calibrate against -- but without it, a boomy
// bass frequency could peg the meter while a genuinely-loud vocal barely
// registers, which is a real shape error a relative meter can still get
// wrong even with no calibration at all.
//
// Implemented as IEC 61672's standard analog A-weighting prototype --
// poles at 20.598997/107.65265/737.86223/12194.217 Hz (the first and
// last as double poles), four zeros at 0Hz -- factored into six simple
// first-order sections (four "s/(s+w)" sections using the zeros, two
// pure "w/(s+w)" lowpass sections for the remaining double pole with no
// zeros left to pair with it), each converted to a digital IIR section
// via the standard prewarped bilinear transform. Six real IIRFilterNodes
// chained in the audio graph, not a per-frame JS reimplementation --
// the browser filters every sample as part of the normal audio pipeline,
// so there's no windowing/state-continuity gap between animation frames
// the way a hand-rolled filter over each polled snapshot buffer would
// have.
const A_WEIGHTING_POLES_HZ = [20.598997, 20.598997, 107.65265, 737.86223, 12194.217, 12194.217];
// The double pole at 12194.217Hz has no zero left to pair with (all four
// zeros are used up by the other four sections) -- true lowpass sections.
const A_WEIGHTING_LOWPASS_INDEXES = new Set([4, 5]);

// A single real analog pole at angular frequency w (rad/s), prewarped
// then bilinear-transformed. `differentiator` picks between the two
// elementary section shapes: s/(s+w) (a zero at DC, gain 1 at Nyquist)
// when true, or w/(s+w) (gain 1 at DC, a zero at Nyquist) when false.
function polePrewarpedBiquad(poleHz, sampleRate, differentiator) {
  const w = 2 * Math.PI * poleHz;
  const k = 2 * sampleRate * Math.tan(w / (2 * sampleRate));
  const denom = 2 * sampleRate + k;
  const a1 = (k - 2 * sampleRate) / denom;
  if (differentiator) {
    const b0 = (2 * sampleRate) / denom;
    return { b0, b1: -b0, a1 };
  }
  const b0 = k / denom;
  return { b0, b1: b0, a1 };
}

// |H(e^{jω})| for one first-order section at a specific frequency --
// used only to measure the finished cascade's actual gain at 1kHz so it
// can be normalised to 0dB there (the IEC convention), rather than
// trusting a hand-derived constant to land exactly right after six
// independently prewarped stages.
function sectionMagnitudeAt(b0, b1, a1, freqHz, sampleRate) {
  const omega = (2 * Math.PI * freqHz) / sampleRate;
  const cos = Math.cos(omega), sin = Math.sin(omega);
  const numRe = b0 + b1 * cos, numIm = -b1 * sin;
  const denRe = 1 + a1 * cos, denIm = -a1 * sin;
  return Math.sqrt(numRe * numRe + numIm * numIm) / Math.sqrt(denRe * denRe + denIm * denIm);
}

// Builds the 6-section A-weighting chain plus a trailing GainNode that
// normalises it to 0dB at 1kHz, and returns {input, output} to splice
// into an existing audio graph. Falls back to a passthrough (an
// unweighted flat GainNode) on the rare browser with no IIRFilterNode
// support, rather than failing the whole meter over a nice-to-have.
function createAWeightingChain(audioCtx) {
  if (typeof audioCtx.createIIRFilter !== 'function') {
    const passthrough = audioCtx.createGain();
    return { input: passthrough, output: passthrough };
  }
  const sections = A_WEIGHTING_POLES_HZ.map((hz, i) =>
    polePrewarpedBiquad(hz, audioCtx.sampleRate, !A_WEIGHTING_LOWPASS_INDEXES.has(i))
  );
  const nodes = sections.map(({ b0, b1, a1 }) => audioCtx.createIIRFilter([b0, b1], [1, a1]));
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);

  const gainAt1k = sections.reduce((product, { b0, b1, a1 }) => product * sectionMagnitudeAt(b0, b1, a1, 1000, audioCtx.sampleRate), 1);
  const normaliser = audioCtx.createGain();
  normaliser.gain.value = gainAt1k > 0 ? 1 / gainAt1k : 1;
  nodes[nodes.length - 1].connect(normaliser);

  return { input: nodes[0], output: normaliser };
}

// A rough, relative loudness meter -- NOT a calibrated SPL/dB(A) meter.
// A phone or laptop mic's sensitivity varies wildly by device and isn't
// calibrated against a real acoustic reference, so this can only ever
// answer "louder or quieter than a moment ago", not "X decibels" --
// still useful as a quick stage-volume gut check, just not a substitute
// for an actual SPL meter. The signal IS A-weighted before measuring
// (see createAWeightingChain below), so at least its relative SHAPE
// matches how loud things actually sound to a human ear, rather than
// treating a booming bass note and a piercing high note as equally
// "loud" just because they hit the mic at the same raw amplitude. No
// network calls anywhere here either -- mic capture and the level
// calculation are pure Web Audio API work, so this works with no signal
// at a gig the same as it does online.
export default function VolumeMeter() {
  const [status, setStatus] = useState('idle'); // idle | starting | running | error
  const [error, setError] = useState(null);

  const fillRef = useRef(null);
  const peakRef = useRef(null);
  const audioCtxRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const smoothedPctRef = useRef(0);
  const peakPctRef = useRef(0);

  // Release the mic if this tab is left mid-check. stop() only reads refs
  // and stable setters, so the first render's closure is safe to reuse.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => stop, []);

  function applyMeter(pct, db) {
    const clamped = Math.max(0, Math.min(100, pct));
    // Fast attack, slower release -- a real VU meter's ballistics: it
    // should jump up to a sudden loud hit immediately, but ease back down
    // afterwards rather than chasing every quiet gap, which otherwise
    // makes the bar flicker distractingly on normal speech/music.
    smoothedPctRef.current += (clamped - smoothedPctRef.current) * (clamped > smoothedPctRef.current ? 0.5 : 0.12);
    peakPctRef.current = Math.max(clamped, peakPctRef.current * 0.985);

    if (fillRef.current) {
      fillRef.current.style.width = smoothedPctRef.current + '%';
      fillRef.current.className =
        'volmeter-fill' + (db >= RED_DB ? ' volmeter-fill--red' : db >= AMBER_DB ? ' volmeter-fill--amber' : '');
    }
    if (peakRef.current) {
      peakRef.current.style.left = peakPctRef.current + '%';
    }
  }

  async function start() {
    setError(null);
    setStatus('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // autoGainControl especially: leaving it on means the browser
        // constantly renormalises input level for you, which would make
        // this meter show roughly the same reading regardless of how
        // loud the room actually is -- exactly what it's meant to show.
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      streamRef.current = stream;
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioCtxRef.current = audioCtx;
      if (audioCtx.state === 'suspended') await audioCtx.resume();

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      const weighting = createAWeightingChain(audioCtx);
      source.connect(weighting.input);
      weighting.output.connect(analyser);

      const buf = new Float32Array(analyser.fftSize);
      const tick = () => {
        analyser.getFloatTimeDomainData(buf);
        let sumSquares = 0;
        for (let i = 0; i < buf.length; i++) sumSquares += buf[i] * buf[i];
        const rms = Math.sqrt(sumSquares / buf.length);
        const db = rmsToDb(rms);
        applyMeter(dbToPercent(db), db);
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
    smoothedPctRef.current = 0;
    peakPctRef.current = 0;
    setStatus('idle');
    if (fillRef.current) {
      fillRef.current.style.width = '0%';
      fillRef.current.className = 'volmeter-fill';
    }
    if (peakRef.current) peakRef.current.style.left = '0%';
  }

  const micUnsupported = !navigator.mediaDevices?.getUserMedia;

  return (
    <div className="day-sheet__section">
      <h3 className="day-sheet__section-title">Volume meter</h3>
      <p className="field__hint" style={{ marginBottom: 12 }}>
        A rough, relative level from the mic, A-weighted to match how loud things actually sound to the ear — not a calibrated SPL meter, just a quick "is this getting loud" check.
      </p>

      {micUnsupported ? (
        <p className="form-error">This browser doesn't support microphone access, so the volume meter can't run here.</p>
      ) : (
        <>
          {(status === 'idle' || status === 'starting' || status === 'error') && error && (
            <p className="form-error" style={{ marginBottom: 12 }}>{error}</p>
          )}

          <div className="volmeter-track">
            <div className="volmeter-fill" ref={fillRef} style={{ width: '0%' }} />
            <div className="volmeter-peak" ref={peakRef} style={{ left: '0%' }} />
          </div>

          {status === 'running' ? (
            <button className="btn btn--ghost btn--small" style={{ marginTop: 12 }} onClick={stop}>
              Stop meter
            </button>
          ) : (
            <button className="btn btn--primary btn--small" style={{ marginTop: 12 }} onClick={start} disabled={status === 'starting'}>
              {status === 'starting' ? 'Requesting microphone…' : '🎙 Start meter'}
            </button>
          )}
        </>
      )}
    </div>
  );
}

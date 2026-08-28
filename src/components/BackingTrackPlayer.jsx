import { useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import SignalsmithStretch from '../utils/signalsmithStretch.mjs';

const BUCKET = 'backing-tracks';

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m + ':' + String(s).padStart(2, '0');
}

// Standard Web Audio lookahead scheduler (the well-known "A Tale of Two
// Clocks" pattern) -- a plain setInterval firing every beat would drift
// audibly against the backing track, since JS timers aren't sample-accurate.
// This wakes up frequently on a cheap JS timer but only ever schedules real
// clicks against the audio clock (audioContext.currentTime), which is.
function startClickScheduler(audioContext, clickGain, getBpm) {
  let nextClickTime = audioContext.currentTime;
  let beatCount = 0;
  const lookaheadMs = 25;
  const scheduleAheadSeconds = 0.1;

  function scheduleClick(time, accent) {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.frequency.value = accent ? 1600 : 1000;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(1, time + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.03);
    osc.connect(gain).connect(clickGain);
    osc.start(time);
    osc.stop(time + 0.05);
  }

  const timerId = setInterval(() => {
    const bpm = getBpm();
    if (!bpm) return;
    while (nextClickTime < audioContext.currentTime + scheduleAheadSeconds) {
      scheduleClick(nextClickTime, beatCount % 4 === 0);
      nextClickTime += 60 / bpm;
      beatCount++;
    }
  }, lookaheadMs);

  return () => clearInterval(timerId);
}

// Playback only -- listing, selecting, and playing a band's existing
// backing tracks for a song, with live tempo/pitch/click controls.
// Uploading and deleting live in BackingTrackManager (rendered inside
// SongEditFields, under Edit) instead of here, so this component -- and
// the toggle button that opens it -- can be shown to anyone who can listen
// (including a read-only musician on the day sheet, see
// GigDetailBandMember.jsx) without also handing them management controls.
// A band's own recording of a song -- distinct from SongReference.jsx's
// ReferencePlayer, which just embeds a public YouTube/Spotify link for
// what the song sounds like in general, not this band's own arrangement.
export default function BackingTrackPlayer({ band, song }) {
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [activeTrackId, setActiveTrackId] = useState(null);
  const [playerLoading, setPlayerLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [semitones, setSemitones] = useState(0);
  const [trackVolume, setTrackVolume] = useState(0.8);
  const [clickEnabled, setClickEnabled] = useState(false);
  const [clickVolume, setClickVolume] = useState(0.5);

  // Mutable audio-graph handles -- kept in refs, not state, since changing
  // them shouldn't trigger a re-render, and they need to survive across
  // renders to be torn down correctly.
  const audioCtxRef = useRef(null);
  const stretchNodeRef = useRef(null);
  const trackGainRef = useRef(null);
  const clickGainRef = useRef(null);
  const stopClickSchedulerRef = useRef(null);
  const rateRef = useRef(1);
  // Bumped on every loadTrack() call -- lets a call whose async work (signed
  // URL, fetch, decode) finishes *after* a newer call has already started
  // recognise it's stale and tear itself down instead of overwriting the
  // refs a newer, still-in-flight or already-finished load owns.
  const loadTokenRef = useRef(0);

  // The single place that stops and releases everything -- called both at
  // the start of every loadTrack() (so reloading the *same* track, or
  // clicking it again mid-load, can't leave the previous graph playing
  // alongside the new one) and on unmount. Deliberately not tied to a
  // useEffect keyed on activeTrackId: that only re-runs when the id
  // *changes*, so clicking the same track's button twice -- the actual bug
  // reported -- left the first AudioContext running with nothing left
  // referencing it, able to stop it.
  function teardownAudioGraph() {
    stopClickSchedulerRef.current?.();
    stopClickSchedulerRef.current = null;
    try { stretchNodeRef.current?.stop(); } catch { /* already stopped */ }
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    stretchNodeRef.current = null;
    trackGainRef.current = null;
    clickGainRef.current = null;
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error: fetchError } = await supabase
        .from('backing_tracks')
        .select('id, variant, notes, duration_seconds, file_url, created_at')
        .eq('band_id', band.id)
        .eq('song_id', song.id)
        .order('created_at');
      if (cancelled) return;
      if (fetchError) setError(fetchError.message);
      else setTracks(data || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [band.id, song.id]);

  // Unmount-only -- an AudioContext left running after this component
  // disappears leaks audio hardware resources and can keep playing into
  // silence. Track-to-track and same-track-reclick teardown both happen
  // explicitly at the start of loadTrack() instead (see teardownAudioGraph).
  useEffect(() => {
    return () => teardownAudioGraph();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    rateRef.current = rate;
    stretchNodeRef.current?.schedule({ rate, semitones });
  }, [rate, semitones]);

  // setTargetAtTime, not a direct .value assignment -- setting .value
  // repeatedly while a slider is being dragged creates a stepped signal
  // (a new discontinuity at every input event), heard as "zipper noise":
  // small clicks that get proportionally louder, and so more noticeable,
  // the higher the gain -- easy to mistake for the track itself getting
  // harsher/brighter as you turn it up. Ramping to the new value over a
  // few milliseconds removes the discontinuity instead of just making it
  // quieter.
  useEffect(() => {
    if (trackGainRef.current && audioCtxRef.current) {
      trackGainRef.current.gain.setTargetAtTime(trackVolume, audioCtxRef.current.currentTime, 0.015);
    }
  }, [trackVolume]);

  useEffect(() => {
    if (clickGainRef.current && audioCtxRef.current) {
      clickGainRef.current.gain.setTargetAtTime(clickEnabled ? clickVolume : 0, audioCtxRef.current.currentTime, 0.015);
    }
  }, [clickEnabled, clickVolume]);

  async function loadTrack(track) {
    // Tear down whatever's currently loaded *first* -- unconditionally,
    // even if it's this same track -- otherwise re-clicking the same
    // "Backing track" button (or clicking a different one before the first
    // finishes loading) leaves the previous AudioContext running with
    // nothing left pointing at it to stop it, playing on top of the new one.
    teardownAudioGraph();
    const myToken = ++loadTokenRef.current;

    setError(null);
    setPlayerLoading(true);
    setPlaying(false);
    setActiveTrackId(track.id);
    let audioContext;
    try {
      const { data: signed, error: signError } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(track.file_url, 3600);
      if (signError) throw signError;

      const res = await fetch(signed.signedUrl);
      const arrayBuffer = await res.arrayBuffer();

      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      const stretchNode = await SignalsmithStretch(audioContext);

      // A newer loadTrack() call started (and possibly already finished)
      // while this one was still awaiting the network/decode/WASM-init --
      // this call's work is stale, so close what it built instead of
      // clobbering the refs the newer call owns.
      if (loadTokenRef.current !== myToken) {
        audioContext.close();
        return;
      }

      const channels = [];
      for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
        channels.push(audioBuffer.getChannelData(i));
      }
      await stretchNode.addBuffers(channels);
      // formantCompensation was tried here and reverted -- it's built for
      // isolated vocals (it assumes something like a fixed vocal-tract
      // resonance structure to preserve while the pitch moves), not a
      // full-band mix. On a whole backing track it fought the *other*
      // instruments, especially anything doing a continuous pitch glide at
      // the same time (a guitar string bend), producing an audible warble
      // instead of a cleaner one plain pitch-shifting -- with no formant
      // model to satisfy -- doesn't have.
      stretchNode.schedule({ rate, semitones });

      const trackGain = audioContext.createGain();
      trackGain.gain.value = trackVolume;
      const clickGain = audioContext.createGain();
      clickGain.gain.value = clickEnabled ? clickVolume : 0;

      stretchNode.connect(trackGain).connect(audioContext.destination);
      clickGain.connect(audioContext.destination);

      audioCtxRef.current = audioContext;
      stretchNodeRef.current = stretchNode;
      trackGainRef.current = trackGain;
      clickGainRef.current = clickGain;

      if (song.bpm) {
        stopClickSchedulerRef.current = startClickScheduler(
          audioContext,
          clickGain,
          () => song.bpm * rateRef.current
        );
      }
    } catch (err) {
      if (loadTokenRef.current !== myToken) return;
      audioContext?.close();
      setError(err.message || 'Could not load that track');
      setActiveTrackId(null);
    } finally {
      // Guard here too -- a stale call's finally would otherwise clear the
      // loading spinner while a newer, still-in-flight load owns it.
      if (loadTokenRef.current === myToken) setPlayerLoading(false);
    }
  }

  async function togglePlay() {
    const audioContext = audioCtxRef.current;
    const stretchNode = stretchNodeRef.current;
    if (!audioContext || !stretchNode) return;
    if (audioContext.state === 'suspended') await audioContext.resume();
    if (playing) {
      stretchNode.stop();
      setPlaying(false);
    } else {
      stretchNode.start();
      setPlaying(true);
    }
  }

  if (loading) return null;
  // Defensive only -- the toggle button that opens this is only shown by
  // the caller when a track is already known to exist for this song.
  if (tracks.length === 0) return <p className="field__hint">No backing tracks for this song yet.</p>;

  const activeTrack = tracks.find((t) => t.id === activeTrackId);

  return (
    <div style={{ marginTop: 10, padding: 12, background: 'var(--paper-raised)', border: '1px solid var(--line)', borderRadius: 10 }}>
      <p className="field__label" style={{ marginBottom: 8 }}>Backing tracks</p>

      {error && <p className="form-error" style={{ marginBottom: 8 }}>{error}</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: activeTrack ? 14 : 0 }}>
        {tracks.map((t) => (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="link-button"
              style={{ fontWeight: activeTrackId === t.id ? 700 : 400 }}
              onClick={() => loadTrack(t)}
            >
              ▶ {t.variant || 'Backing track'}
            </button>
            {t.duration_seconds && (
              <span className="field__hint">{formatDuration(t.duration_seconds)}</span>
            )}
          </div>
        ))}
      </div>

      {activeTrack && (
        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
          {playerLoading ? (
            <p className="field__hint">Loading…</p>
          ) : (
            <>
              <button type="button" className="btn btn--primary btn--small" onClick={togglePlay} style={{ marginBottom: 12 }}>
                {playing ? '⏸ Pause' : '▶ Play'} — {activeTrack.variant || 'Backing track'}
              </button>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 360 }}>
                <label>
                  <span className="field__hint">Tempo: {Math.round(rate * 100)}%</span>
                  <input
                    type="range"
                    min="0.5"
                    max="1.5"
                    step="0.01"
                    value={rate}
                    onChange={(e) => setRate(Number(e.target.value))}
                    style={{ width: '100%' }}
                  />
                </label>

                <label>
                  <span className="field__hint">
                    Pitch: {semitones > 0 ? '+' : ''}{semitones} semitone{Math.abs(semitones) === 1 ? '' : 's'}
                  </span>
                  <input
                    type="range"
                    min="-12"
                    max="12"
                    step="1"
                    value={semitones}
                    onChange={(e) => setSemitones(Number(e.target.value))}
                    style={{ width: '100%' }}
                  />
                </label>

                <label>
                  <span className="field__hint">Volume</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={trackVolume}
                    onChange={(e) => setTrackVolume(Number(e.target.value))}
                    style={{ width: '100%' }}
                  />
                </label>

                {song.bpm ? (
                  <div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input type="checkbox" checked={clickEnabled} onChange={(e) => setClickEnabled(e.target.checked)} />
                      <span className="field__hint">Click track ({Math.round(song.bpm * rate)} BPM)</span>
                    </label>
                    {clickEnabled && (
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={clickVolume}
                        onChange={(e) => setClickVolume(Number(e.target.value))}
                        style={{ width: '100%', marginTop: 6 }}
                      />
                    )}
                  </div>
                ) : (
                  <p className="field__hint">Set this song's BPM (via Edit) to enable an automatic click track.</p>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

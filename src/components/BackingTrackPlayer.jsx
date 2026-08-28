import { useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useCurrentProfile } from '../context/ProfileContext.jsx';
import { validateAudioFile, readAudioDuration } from '../utils/audioUpload.js';
import { notify } from '../utils/toastService.js';
import { confirmAsync } from '../utils/confirmService.js';
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

// Per-(band, song) backing track library + player. A band's own recording
// of a song -- distinct from SongReference.jsx's ReferencePlayer, which
// just embeds a public YouTube/Spotify link for what the song sounds like
// in general, not this band's own arrangement.
export default function BackingTrackPlayer({ band, song }) {
  const { isAdmin, ledBandIds } = useCurrentProfile();
  const canManage = isAdmin || ledBandIds.includes(band.id);

  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [variantInput, setVariantInput] = useState('');

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error: fetchError } = await supabase
        .from('backing_tracks')
        .select('id, variant, notes, duration_seconds, file_url, uploaded_by, created_at')
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

  // Tear down the whole audio graph on unmount or track change -- an
  // AudioContext left running after the component using it disappears
  // leaks audio hardware resources and can keep playing into silence.
  useEffect(() => {
    return () => {
      stopClickSchedulerRef.current?.();
      audioCtxRef.current?.close();
      audioCtxRef.current = null;
      stretchNodeRef.current = null;
    };
  }, [activeTrackId]);

  useEffect(() => {
    rateRef.current = rate;
    stretchNodeRef.current?.schedule({ rate, semitones });
  }, [rate, semitones]);

  useEffect(() => {
    if (trackGainRef.current) trackGainRef.current.gain.value = trackVolume;
  }, [trackVolume]);

  useEffect(() => {
    if (clickGainRef.current) clickGainRef.current.gain.value = clickEnabled ? clickVolume : 0;
  }, [clickEnabled, clickVolume]);

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const validation = validateAudioFile(file);
    if (!validation.ok) {
      setError(validation.error);
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const duration = await readAudioDuration(file);
      const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
      const path = `${band.id}/${song.id}/${Date.now()}-${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType: 'audio/mpeg' });
      if (uploadError) throw uploadError;

      const { data: sessionData } = await supabase.auth.getSession();
      const { data: inserted, error: insertError } = await supabase
        .from('backing_tracks')
        .insert({
          band_id: band.id,
          song_id: song.id,
          file_url: path,
          variant: variantInput.trim() || null,
          duration_seconds: duration,
          uploaded_by: sessionData?.session?.user?.id || null,
        })
        .select('id, variant, notes, duration_seconds, file_url, uploaded_by, created_at')
        .single();
      if (insertError) throw insertError;

      setTracks((prev) => [...prev, inserted]);
      setVariantInput('');
    } catch (err) {
      setError(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(track) {
    const ok = await confirmAsync('Delete this backing track? This cannot be undone.');
    if (!ok) return;
    const { error: storageError } = await supabase.storage.from(BUCKET).remove([track.file_url]);
    if (storageError) { notify("Couldn't delete the file: " + storageError.message); return; }
    const { error: dbError } = await supabase.from('backing_tracks').delete().eq('id', track.id);
    if (dbError) { notify("Couldn't delete the track: " + dbError.message); return; }
    if (activeTrackId === track.id) {
      setActiveTrackId(null);
      setPlaying(false);
    }
    setTracks((prev) => prev.filter((t) => t.id !== track.id));
  }

  async function loadTrack(track) {
    setError(null);
    setPlayerLoading(true);
    setPlaying(false);
    setActiveTrackId(track.id);
    try {
      const { data: signed, error: signError } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(track.file_url, 3600);
      if (signError) throw signError;

      const res = await fetch(signed.signedUrl);
      const arrayBuffer = await res.arrayBuffer();

      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      const stretchNode = await SignalsmithStretch(audioContext);
      const channels = [];
      for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
        channels.push(audioBuffer.getChannelData(i));
      }
      await stretchNode.addBuffers(channels);
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
      setError(err.message || 'Could not load that track');
      setActiveTrackId(null);
    } finally {
      setPlayerLoading(false);
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

  const activeTrack = tracks.find((t) => t.id === activeTrackId);

  return (
    <div style={{ marginTop: 10, padding: 12, background: 'var(--paper-raised)', border: '1px solid var(--line)', borderRadius: 10 }}>
      <p className="field__label" style={{ marginBottom: 8 }}>Backing tracks</p>

      {error && <p className="form-error" style={{ marginBottom: 8 }}>{error}</p>}

      {tracks.length === 0 ? (
        <p className="field__hint">No backing tracks uploaded for this song yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
          {tracks.map((t) => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                className={'link-button' + (activeTrackId === t.id ? '' : '')}
                style={{ fontWeight: activeTrackId === t.id ? 700 : 400 }}
                onClick={() => loadTrack(t)}
              >
                ▶ {t.variant || 'Backing track'}
              </button>
              {t.duration_seconds && (
                <span className="field__hint">{formatDuration(t.duration_seconds)}</span>
              )}
              {canManage && (
                <button type="button" className="link-button link-button--danger" onClick={() => handleDelete(t)}>
                  Delete
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {canManage && (
        <div style={{ marginBottom: activeTrack ? 14 : 0 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="Label, e.g. Full band, No vocals…"
              value={variantInput}
              onChange={(e) => setVariantInput(e.target.value)}
              style={{ maxWidth: 220 }}
            />
            <label className="btn btn--ghost btn--small" style={{ cursor: 'pointer' }}>
              {uploading ? 'Uploading…' : '+ Upload MP3'}
              <input type="file" accept="audio/mpeg" onChange={handleUpload} disabled={uploading} style={{ display: 'none' }} />
            </label>
          </div>
        </div>
      )}

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

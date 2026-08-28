import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useCurrentProfile } from '../context/ProfileContext.jsx';
import { validateAudioFile, readAudioDuration } from '../utils/audioUpload.js';
import { notify } from '../utils/toastService.js';
import { confirmAsync } from '../utils/confirmService.js';

const BUCKET = 'backing-tracks';

// Upload/delete for a band's backing tracks on a song -- the management
// half split out of what used to be BackingTrackPlayer.jsx (see that
// file's own comment). Rendered inside SongEditFields, under Edit, rather
// than as a separate always-visible control on the setlist row -- it's
// canManage-gated here too, belt-and-braces, even though the only place
// this renders (a band-scoped Edit form) already implies permission.
export default function BackingTrackManager({ band, song, onChanged }) {
  const { isAdmin, ledBandIds } = useCurrentProfile();
  const canManage = isAdmin || ledBandIds.includes(band.id);

  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [variantInput, setVariantInput] = useState('');

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
        .select('id, variant, notes, duration_seconds, file_url, created_at')
        .single();
      if (insertError) throw insertError;

      setTracks((prev) => [...prev, inserted]);
      setVariantInput('');
      onChanged?.();
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
    setTracks((prev) => prev.filter((t) => t.id !== track.id));
    onChanged?.();
  }

  if (!canManage || loading) return null;

  return (
    <div style={{ marginTop: 12 }}>
      <span className="field__label">Backing tracks (for this band)</span>

      {error && <p className="form-error" style={{ marginTop: 4 }}>{error}</p>}

      {tracks.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '6px 0' }}>
          {tracks.map((t) => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="field__hint">{t.variant || 'Backing track'}</span>
              <button type="button" className="link-button link-button--danger" onClick={() => handleDelete(t)}>
                Delete
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
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
  );
}

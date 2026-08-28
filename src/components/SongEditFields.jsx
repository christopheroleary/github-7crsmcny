import { useState } from 'react';
import { supabase } from '../supabaseClient';
import BackingTrackManager from './BackingTrackManager.jsx';

function cleanArtist(artist) {
  return artist
    .replace(/^the\s+/i, '')
    .replace(/\s+feat\.?.*/i, '')
    .replace(/\s+ft\.?.*/i, '')
    .replace(/\s+featuring.*/i, '')
    .replace(/\s*\(.*?\)\s*/g, '')
    .trim();
}

// Shared by GigSetlist.jsx (editing a song from within a setlist) and
// SongsList.jsx (the admin repertoire page) -- same form, same save
// behaviour, so the two don't drift the way the invoice preview/print
// paths did.
export default function SongEditFields({ song, canMakePublic, onSaved, onCancel, bandId, onTracksChanged }) {
  const [title, setTitle] = useState(song.title || '');
  const [artist, setArtist] = useState(song.artist || '');
  const [key, setKey] = useState(song.original_key || '');
  const [bpm, setBpm] = useState(song.bpm != null ? String(song.bpm) : '');
  const [referenceUrl, setReferenceUrl] = useState(song.reference_url || '');
  const [lyrics, setLyrics] = useState(song.lyrics || '');
  const [isPublic, setIsPublic] = useState(Boolean(song.is_public));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const cleanedArtist = artist ? cleanArtist(artist) : '';

  const youtubeSearchUrl = 'https://www.youtube.com/results?search_query=' +
    encodeURIComponent(
      artist
        ? `${title} "${cleanedArtist}" official audio`
        : `${title} official audio`
    );

  const spotifySearchUrl = artist
    ? `https://open.spotify.com/search/track:${encodeURIComponent(title)}%20artist:${encodeURIComponent(cleanedArtist)}`
    : `https://open.spotify.com/search/track:${encodeURIComponent(title)}`;

  const lyricsSearchUrl = 'https://www.google.com/search?q=' +
    encodeURIComponent((artist ? artist + ' ' : '') + title + ' lyrics genius');

  const chordsSearchUrl = 'https://www.google.com/search?q=' +
    encodeURIComponent((artist ? artist + ' ' : '') + title + ' chords and lyrics');

  function handleAutoFill() {
    if (!referenceUrl) {
      setReferenceUrl(youtubeSearchUrl);
    }
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload = {
      title,
      artist: artist || null,
      original_key: key || null,
      bpm: bpm === '' ? null : Math.min(300, Math.max(30, Math.round(Number(bpm)))),
      reference_url: referenceUrl || null,
      lyrics: lyrics || null,
    };
    if (canMakePublic) payload.is_public = isPublic;

    const { error } = await supabase
      .from('songs')
      .update(payload)
      .eq('id', song.id);
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    onSaved();
  }

  return (
    <form className="song-edit" onSubmit={handleSave}>
      <div className="field-row">
        <label className="field">
          <span className="field__label">Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label className="field">
          <span className="field__label">Artist</span>
          <input value={artist} onChange={(e) => setArtist(e.target.value)} />
        </label>
        <label className="field" style={{ maxWidth: 90 }}>
          <span className="field__label">Key</span>
          <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="e.g. G" />
        </label>
        <label className="field" style={{ maxWidth: 100 }}>
          <span className="field__label">BPM</span>
          {/* A plain live input, not NumberInput -- that component opens a
              confirm-then-close keypad (right for a money field where an
              accidental scroll-wheel edit is a real risk), but its overlay
              covers the whole form while open, including Save. Typing a
              BPM and then clicking Save without first tapping the keypad's
              own "Done" landed on that overlay instead, which *cancels*
              rather than commits -- silently reverting to blank. BPM is
              typed once and immediately followed by Save, so a plain
              always-live field removes the trap; inputMode="numeric" still
              gets a numeric keyboard on mobile without inheriting
              type="number"'s mouse-scroll-changes-the-value bug. */}
          <input
            type="text"
            inputMode="numeric"
            value={bpm}
            onChange={(e) => setBpm(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="e.g. 120"
          />
        </label>
      </div>

      <label className="field">
        <span className="field__label">
          Reference link{' '}
          <a href={youtubeSearchUrl} target="_blank" rel="noopener noreferrer" className="link-button" style={{ display: 'inline' }}>
            Find on YouTube ↗
          </a>
          {!referenceUrl && (
            <>
              {' · '}
              <button type="button" className="link-button" style={{ display: 'inline' }} onClick={handleAutoFill}>
                Auto-fill YouTube search
              </button>
            </>
          )}
          {' · '}
          <a href={spotifySearchUrl} target="_blank" rel="noopener noreferrer" className="link-button" style={{ display: 'inline' }}>
            Find on Spotify ↗
          </a>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 4 }}>
            (30s preview only)
          </span>
        </span>
        <input
          value={referenceUrl}
          onChange={(e) => setReferenceUrl(e.target.value)}
          placeholder="Paste a YouTube URL for full playback"
        />
      </label>

      <label className="field">
        <span className="field__label">
          Lyrics{' '}
          <a href={lyricsSearchUrl} target="_blank" rel="noopener noreferrer" className="link-button" style={{ display: 'inline' }}>
            Find lyrics ↗
          </a>
          {' · '}
          <a href={chordsSearchUrl} target="_blank" rel="noopener noreferrer" className="link-button" style={{ display: 'inline' }}>
            Find chords ↗
          </a>
        </span>
        <textarea
          value={lyrics}
          onChange={(e) => setLyrics(e.target.value)}
          rows={8}
          placeholder={'Paste lyrics (or your own chord notes) here. Wrap section markers in brackets to bold them, e.g.\n[Verse 1]\n[Chorus]'}
        />
      </label>

      {/* Only appears when editing from a band-scoped context (GigSetlist) --
          songs themselves aren't band-owned (shared/public catalog, see
          is_public above), but backing tracks are, so this has nothing
          sensible to show on the global Repertoire page (SongsList.jsx),
          which never passes bandId. */}
      {bandId && <BackingTrackManager band={{ id: bandId }} song={song} onChanged={onTracksChanged} />}

      {canMakePublic && (
        <label className="field field--checkbox">
          <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
          <span>Share with all bands</span>
        </label>
      )}

      {error && <p className="form-error">{error}</p>}

      <div className="form-actions">
        <button type="button" className="btn btn--ghost btn--small" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn--primary btn--small" disabled={saving}>
          {saving ? 'Saving…' : 'Save song'}
        </button>
      </div>
    </form>
  );
}

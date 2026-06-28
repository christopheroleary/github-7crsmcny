import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useCurrentProfile } from '../hooks/useCurrentProfile.js';

export default function GigSetlist({ gigId, bandId }) {
  const { isAdmin } = useCurrentProfile();
  const [bandSetlists, setBandSetlists] = useState([]);
  const [attachedIds, setAttachedIds] = useState([]);
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newSetName, setNewSetName] = useState('');
  const [pickedExistingId, setPickedExistingId] = useState('');
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!bandId) {
      setLoading(false);
      return;
    }
    setLoading(true);

    const { data: setlistRows } = await supabase
      .from('setlists')
      .select('id, name, setlist_items(id, position, songs(id, title, artist, original_key, lyrics, reference_url))')
      .eq('band_id', bandId)
      .order('name');

    const sorted = (setlistRows || []).map((sl) => ({
      ...sl,
      setlist_items: [...(sl.setlist_items || [])].sort((a, b) => a.position - b.position),
    }));
    setBandSetlists(sorted);

    const { data: links } = await supabase.from('gig_setlists').select('setlist_id').eq('gig_id', gigId);
    setAttachedIds((links || []).map((l) => l.setlist_id));

    const { data: songRows } = await supabase.from('songs').select('id, title').order('title');
    setSongs(songRows || []);
    setLoading(false);
  }, [gigId, bandId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreateAndAttach(e) {
    e.preventDefault();
    if (!newSetName.trim()) return;
    const { data: newSetlist, error: createError } = await supabase
      .from('setlists')
      .insert({ band_id: bandId, name: newSetName })
      .select()
      .single();
    if (createError) {
      setError(createError.message);
      return;
    }
    const { error: attachError } = await supabase.from('gig_setlists').insert({ gig_id: gigId, setlist_id: newSetlist.id });
    if (attachError) {
      setError(attachError.message);
      return;
    }
    setNewSetName('');
    load();
  }

  async function handleAttachExisting(e) {
    e.preventDefault();
    if (!pickedExistingId) return;
    const { error } = await supabase.from('gig_setlists').insert({ gig_id: gigId, setlist_id: pickedExistingId });
    if (error) {
      setError(error.message);
      return;
    }
    setPickedExistingId('');
    load();
  }

  async function handleDetach(setlistId) {
    const ok = window.confirm("Remove this set from tonight's gig? It stays in the band's library for reuse elsewhere.");
    if (!ok) return;
    const { error } = await supabase.from('gig_setlists').delete().eq('gig_id', gigId).eq('setlist_id', setlistId);
    if (error) {
      alert("Couldn't remove: " + error.message);
      return;
    }
    load();
  }

  async function handleDeleteTemplate(setlist) {
    const ok = window.confirm(
      'Permanently delete "' + setlist.name + '" from the band library? This removes it from every gig that uses it, not just this one. This cannot be undone.'
    );
    if (!ok) return;
    const { error } = await supabase.from('setlists').delete().eq('id', setlist.id);
    if (error) {
      alert("Couldn't delete: " + error.message);
      return;
    }
    load();
  }

  async function handleAddSong(setlist, songId, newTitle) {
    let finalSongId = songId;
    if (!finalSongId && newTitle && newTitle.trim()) {
      const { data: newSong, error: songError } = await supabase.from('songs').insert({ title: newTitle }).select().single();
      if (songError) {
        alert("Couldn't create song: " + songError.message);
        return;
      }
      finalSongId = newSong.id;
    }
    if (!finalSongId) return;

    const nextPosition = setlist.setlist_items.length + 1;
    const { error } = await supabase
      .from('setlist_items')
      .insert({ setlist_id: setlist.id, song_id: finalSongId, position: nextPosition });
    if (error) {
      alert("Couldn't add song: " + error.message);
      return;
    }
    load();
  }

  async function handleRemoveSong(item) {
    const { error } = await supabase.from('setlist_items').delete().eq('id', item.id);
    if (error) {
      alert("Couldn't remove song: " + error.message);
      return;
    }
    load();
  }

  if (!bandId) {
    return (
      <div className="roster-section">
        <h3 className="roster-section__title">Setlist</h3>
        <p className="state-message" style={{ textAlign: 'left', padding: 0 }}>
          Assign a band to this gig first — setlists now live in a band's library, so this gig needs to know which band it's for.
        </p>
      </div>
    );
  }

  if (loading) return <p className="state-message">Loading setlist…</p>;

  const attachedSetlists = bandSetlists.filter((sl) => attachedIds.includes(sl.id));
  const availableToAttach = bandSetlists.filter((sl) => !attachedIds.includes(sl.id));

  return (
    <div className="roster-section">
      <h3 className="roster-section__title">Setlist</h3>

      {attachedSetlists.length === 0 && <p className="state-message">No sets attached to this gig yet.</p>}

      {attachedSetlists.map((setlist) => (
        <SetlistBlock
          key={setlist.id}
          setlist={setlist}
          songs={songs}
          isAdmin={isAdmin}
          onAddSong={handleAddSong}
          onRemoveSong={handleRemoveSong}
          onDetach={() => handleDetach(setlist.id)}
          onDeleteTemplate={() => handleDeleteTemplate(setlist)}
          reload={load}
        />
      ))}

      {isAdmin && (
        <div className="inline-subform">
          {availableToAttach.length > 0 && (
            <form onSubmit={handleAttachExisting} style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <select value={pickedExistingId} onChange={(e) => setPickedExistingId(e.target.value)}>
                <option value="">Attach an existing set from this band's library…</option>
                {availableToAttach.map((sl) => (
                  <option key={sl.id} value={sl.id}>{sl.name}</option>
                ))}
              </select>
              <button type="submit" className="btn btn--ghost btn--small">Attach</button>
            </form>
          )}
          <form onSubmit={handleCreateAndAttach} style={{ display: 'flex', gap: 8 }}>
            <input placeholder="Or create a new set, e.g. Set 2" value={newSetName} onChange={(e) => setNewSetName(e.target.value)} />
            <button type="submit" className="btn btn--primary btn--small">+ Create</button>
          </form>
          {error && <p className="form-error">{error}</p>}
        </div>
      )}
    </div>
  );
}

function SetlistBlock({ setlist, songs, isAdmin, onAddSong, onRemoveSong, onDetach, onDeleteTemplate, reload }) {
  const [pickedSongId, setPickedSongId] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [editingItemId, setEditingItemId] = useState(null);
  const [showLyricsId, setShowLyricsId] = useState(null);
  const [showPlayerId, setShowPlayerId] = useState(null);

  function handleAdd(e) {
    e.preventDefault();
    onAddSong(setlist, pickedSongId || null, newTitle);
    setPickedSongId('');
    setNewTitle('');
  }

  function handleDragStart(e, itemId) {
    e.dataTransfer.setData('text/plain', itemId);
  }
  function handleDragOver(e) {
    e.preventDefault();
  }
  async function handleDrop(e, targetItemId) {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData('text/plain');
    if (!draggedId || draggedId === targetItemId) return;

    const items = [...setlist.setlist_items];
    const fromIndex = items.findIndex((i) => i.id === draggedId);
    const toIndex = items.findIndex((i) => i.id === targetItemId);
    if (fromIndex === -1 || toIndex === -1) return;

    const [moved] = items.splice(fromIndex, 1);
    items.splice(toIndex, 0, moved);

    await Promise.all(items.map((item, idx) => supabase.from('setlist_items').update({ position: idx + 1 }).eq('id', item.id)));
    reload();
  }

  return (
    <div className="setlist-block">
      <div className="section-header">
        <h4 className="section-header__title" style={{ fontSize: 15 }}>{setlist.name}</h4>
        {isAdmin && (
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="link-button" onClick={onDetach}>Remove from this gig</button>
            <button className="link-button link-button--danger" onClick={onDeleteTemplate}>Delete set entirely</button>
          </div>
        )}
      </div>

      {setlist.setlist_items.length === 0 ? (
        <p className="state-message" style={{ padding: '4px 0', textAlign: 'left' }}>No songs added yet.</p>
      ) : (
        <ol className="setlist-block__songs">
          {setlist.setlist_items.map((item) => {
            const song = item.songs;
            const isEditing = editingItemId === item.id;
            return (
              <li
                key={item.id}
                draggable
                onDragStart={(e) => handleDragStart(e, item.id)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, item.id)}
                className="setlist-song"
              >
                <div className="setlist-song__row">
                  <span className="setlist-song__handle" title="Drag to reorder">⠿</span>
                  <span className="setlist-song__title">
                    {song?.title}
                    {song?.original_key ? <span className="setlist-song__key">{song.original_key}</span> : null}
                  </span>
                  <div className="setlist-song__actions">
                    {song?.reference_url && (
                      <button className="link-button" onClick={() => setShowPlayerId(showPlayerId === item.id ? null : item.id)}>
                        {showPlayerId === item.id ? 'Hide player' : 'Listen'}
                      </button>
                    )}
                    {song?.lyrics && (
                      <button className="link-button" onClick={() => setShowLyricsId(showLyricsId === item.id ? null : item.id)}>
                        {showLyricsId === item.id ? 'Hide lyrics' : 'Lyrics'}
                      </button>
                    )}
                    <button className="link-button" onClick={() => setEditingItemId(isEditing ? null : item.id)}>
                      {isEditing ? 'Close' : 'Edit'}
                    </button>
                    <button className="link-button link-button--danger" onClick={() => onRemoveSong(item)}>×</button>
                  </div>
                </div>

                {isEditing && (
                  <SongEditFields
                    song={song}
                    onSaved={() => {
                      setEditingItemId(null);
                      reload();
                    }}
                    onCancel={() => setEditingItemId(null)}
                  />
                )}

                {!isEditing && showPlayerId === item.id && <ReferencePlayer url={song?.reference_url} />}
                {!isEditing && showLyricsId === item.id && <LyricsView text={song?.lyrics} />}
              </li>
            );
          })}
        </ol>
      )}

      {isAdmin && (
        <form className="setlist-block__add" onSubmit={handleAdd}>
          <select
            value={pickedSongId}
            onChange={(e) => {
              setPickedSongId(e.target.value);
              setNewTitle('');
            }}
          >
            <option value="">Pick an existing song…</option>
            {songs.map((s) => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
          </select>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>or</span>
          <input
            placeholder="Type a new song title"
            value={newTitle}
            onChange={(e) => {
              setNewTitle(e.target.value);
              setPickedSongId('');
            }}
          />
          <button type="submit" className="btn btn--ghost btn--small">+ Add</button>
        </form>
      )}
    </div>
  );
}

function SongEditFields({ song, onSaved, onCancel }) {
  const [title, setTitle] = useState(song.title || '');
  const [artist, setArtist] = useState(song.artist || '');
  const [key, setKey] = useState(song.original_key || '');
  const [referenceUrl, setReferenceUrl] = useState(song.reference_url || '');
  const [lyrics, setLyrics] = useState(song.lyrics || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const lyricsSearchUrl = 'https://www.google.com/search?q=' + encodeURIComponent((artist ? artist + ' ' : '') + title + ' lyrics');
  const chordsSearchUrl = 'https://www.google.com/search?q=' + encodeURIComponent((artist ? artist + ' ' : '') + title + ' chords');

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const { error } = await supabase
      .from('songs')
      .update({
        title,
        artist: artist || null,
        original_key: key || null,
        reference_url: referenceUrl || null,
        lyrics: lyrics || null,
      })
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
      </div>

      <label className="field">
        <span className="field__label">YouTube or Spotify link</span>
        <input value={referenceUrl} onChange={(e) => setReferenceUrl(e.target.value)} placeholder="Paste a YouTube or Spotify track URL" />
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

function ReferencePlayer({ url }) {
  if (!url) return null;
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
  if (ytMatch) {
    return (
      <div className="reference-player">
        <iframe
          width="100%"
          height="200"
          src={'https://www.youtube.com/embed/' + ytMatch[1]}
          title="Song reference"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }
  const spotifyMatch = url.match(/open\.spotify\.com\/(track|album|playlist)\/([\w]+)/);
  if (spotifyMatch) {
    return (
      <div className="reference-player">
        <iframe
          width="100%"
          height="152"
          src={'https://open.spotify.com/embed/' + spotifyMatch[1] + '/' + spotifyMatch[2]}
          title="Song reference"
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        />
      </div>
    );
  }
  return (
    <p className="state-message" style={{ textAlign: 'left', padding: '8px 0' }}>
      <a href={url} target="_blank" rel="noopener noreferrer">Open reference link ↗</a>
    </p>
  );
}

function LyricsView({ text }) {
  if (!text) return null;
  const lines = text.split('\n');
  return (
    <div className="lyrics-view">
      {lines.map((line, i) =>
        /^\[.+\]$/.test(line.trim()) ? (
          <p key={i} className="lyrics-view__section">{line}</p>
        ) : (
          <p key={i} className="lyrics-view__line">{line || '\u00A0'}</p>
        )
      )}
    </div>
  );
}
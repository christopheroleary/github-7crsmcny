import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useCurrentProfile } from '../hooks/useCurrentProfile.js';

export default function GigSetlist({ gigId }) {
  const { isAdmin } = useCurrentProfile();
  const [setlists, setSetlists] = useState([]);
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newSetName, setNewSetName] = useState('');
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: setlistRows } = await supabase
      .from('setlists')
      .select('id, name, setlist_items(id, position, songs(id, title, artist, original_key, lyrics))')
      .eq('gig_id', gigId)
      .order('name');

    const sorted = (setlistRows || []).map((sl) => ({
      ...sl,
      setlist_items: [...(sl.setlist_items || [])].sort((a, b) => a.position - b.position),
    }));
    setSetlists(sorted);

    const { data: songRows } = await supabase.from('songs').select('id, title').order('title');
    setSongs(songRows || []);
    setLoading(false);
  }, [gigId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAddSetlist(e) {
    e.preventDefault();
    if (!newSetName.trim()) return;
    const { error } = await supabase.from('setlists').insert({ gig_id: gigId, name: newSetName });
    if (error) {
      setError(error.message);
      return;
    }
    setNewSetName('');
    load();
  }

  async function handleDeleteSetlist(setlist) {
    const ok = window.confirm('Delete "' + setlist.name + '" and all its songs from this gig?');
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

  if (loading) return <p className="state-message">Loading setlist…</p>;

  return (
    <div className="roster-section">
      <h3 className="roster-section__title">Setlist</h3>

      {setlists.length === 0 && <p className="state-message">No sets yet.</p>}

      {setlists.map((setlist) => (
        <SetlistBlock
          key={setlist.id}
          setlist={setlist}
          songs={songs}
          isAdmin={isAdmin}
          onAddSong={handleAddSong}
          onRemoveSong={handleRemoveSong}
          onDeleteSetlist={handleDeleteSetlist}
          reload={load}
        />
      ))}

      {isAdmin && (
        <form className="inline-subform" onSubmit={handleAddSetlist}>
          <input placeholder="New set name, e.g. Set 2" value={newSetName} onChange={(e) => setNewSetName(e.target.value)} />
          {error && <p className="form-error">{error}</p>}
          <button type="submit" className="btn btn--primary btn--small">+ Add a set</button>
        </form>
      )}
    </div>
  );
}

function SetlistBlock({ setlist, songs, isAdmin, onAddSong, onRemoveSong, onDeleteSetlist, reload }) {
  const [pickedSongId, setPickedSongId] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [editingItemId, setEditingItemId] = useState(null);
  const [showLyricsId, setShowLyricsId] = useState(null);

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

    await Promise.all(
      items.map((item, idx) => supabase.from('setlist_items').update({ position: idx + 1 }).eq('id', item.id))
    );
    reload();
  }

  return (
    <div className="setlist-block">
      <div className="section-header">
        <h4 className="section-header__title" style={{ fontSize: 15 }}>{setlist.name}</h4>
        {isAdmin && (
          <button className="link-button link-button--danger" onClick={() => onDeleteSetlist(setlist)}>
            Delete set
          </button>
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
  const [lyrics, setLyrics] = useState(song.lyrics || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const searchUrl = 'https://www.google.com/search?q=' + encodeURIComponent((artist ? artist + ' ' : '') + title + ' lyrics');

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const { error } = await supabase
      .from('songs')
      .update({ title, artist: artist || null, original_key: key || null, lyrics: lyrics || null })
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
        <span className="field__label">
          Lyrics{' '}
          <a href={searchUrl} target="_blank" rel="noopener noreferrer" className="link-button" style={{ display: 'inline' }}>
            Find lyrics ↗
          </a>
        </span>
        <textarea
          value={lyrics}
          onChange={(e) => setLyrics(e.target.value)}
          rows={8}
          placeholder={'Paste lyrics here. Wrap section markers in brackets to bold them, e.g.\n[Verse 1]\n[Chorus]'}
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
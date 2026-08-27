import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useCurrentProfile } from '../context/ProfileContext.jsx';
import ImportSetlist from './ImportSetlist.jsx';
import SongEditFields from './SongEditFields.jsx';
import { ReferencePlayer, LyricsView } from './SongReference.jsx';
import { confirmAsync } from '../utils/confirmService.js';
import { notify } from '../utils/toastService.js';
import { DndContext, DragOverlay, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export default function GigSetlist({ gigId, bandId }) {
  const { isAdmin, isBandLeader, profile } = useCurrentProfile();
  const canManage = isAdmin || isBandLeader;
  const [bandSetlists, setBandSetlists] = useState([]);
  const [attachedIds, setAttachedIds] = useState([]);
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newSetName, setNewSetName] = useState('');
  const [pickedExistingId, setPickedExistingId] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [error, setError] = useState(null);

  // Split from loadSongs below: attaching/detaching/reordering a setlist on
  // THIS gig never creates or renames a song, so most mutations' post-write
  // refresh only need to redo this, not the whole song catalog too.
  const loadSetlists = useCallback(async () => {
    if (!bandId) {
      setLoading(false);
      return;
    }
    setLoading(true);

    const { data: setlistRows } = await supabase
      .from('setlists')
      .select('id, name, setlist_items(id, position, song_id, songs(id, title, artist, original_key, lyrics, reference_url, is_public))')
      .eq('band_id', bandId)
      .order('name');

    const sorted = (setlistRows || []).map((sl) => ({
      ...sl,
      setlist_items: [...(sl.setlist_items || [])].sort((a, b) => a.position - b.position),
    }));
    setBandSetlists(sorted);

    const { data: links } = await supabase.from('gig_setlists').select('setlist_id').eq('gig_id', gigId);
    setAttachedIds((links || []).map((l) => l.setlist_id));
    setLoading(false);
  }, [gigId, bandId]);

  // The whole-catalog "add a song" picker -- not scoped to this band or gig
  // at all, so it only needs loading once per mount, plus again on the two
  // mutations that can actually add to it: typing a brand new song title in
  // handleAddSong, or importing a pasted setlist with unmatched songs.
  const loadSongs = useCallback(async () => {
    const { data: songRows } = await supabase.from('songs').select('id, title, artist').order('title');
    setSongs(songRows || []);
  }, []);

  useEffect(() => {
    loadSetlists();
    loadSongs();
  }, [loadSetlists, loadSongs]);

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
    loadSetlists();
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
    loadSetlists();
  }

  async function handleDetach(setlistId) {
    const ok = await confirmAsync("Remove this set from tonight's gig? It stays in the band's library for reuse elsewhere.");
    if (!ok) return;
    const { error } = await supabase.from('gig_setlists').delete().eq('gig_id', gigId).eq('setlist_id', setlistId);
    if (error) {
      notify("Couldn't remove: " + error.message);
      return;
    }
    loadSetlists();
  }

  async function handleDeleteTemplate(setlist) {
    const ok = await confirmAsync(
      'Permanently delete "' + setlist.name + '" from the band library? This removes it from every gig that uses it, not just this one. This cannot be undone.'
    );
    if (!ok) return;
    const { error } = await supabase.from('setlists').delete().eq('id', setlist.id);
    if (error) {
      notify("Couldn't delete: " + error.message);
      return;
    }
    loadSetlists();
  }

  async function handleAddSong(setlist, songId, newTitle) {
    let finalSongId = songId;
    let createdNewSong = false;
    if (!finalSongId && newTitle && newTitle.trim()) {
      const { data: newSong, error: songError } = await supabase
        .from('songs')
        .insert({ title: newTitle, created_by: isAdmin ? null : profile?.id })
        .select()
        .single();
      if (songError) {
        notify("Couldn't create song: " + songError.message);
        return;
      }
      finalSongId = newSong.id;
      createdNewSong = true;
    }
    if (!finalSongId) return;

    const nextPosition = setlist.setlist_items.length + 1;
    const { error } = await supabase
      .from('setlist_items')
      .insert({ setlist_id: setlist.id, song_id: finalSongId, position: nextPosition });
    if (error) {
      notify("Couldn't add song: " + error.message);
      return;
    }
    loadSetlists();
    // Only a brand new song title changes the catalog -- picking an
    // existing song from the dropdown doesn't need this refreshed too.
    if (createdNewSong) loadSongs();
  }

  async function handleRemoveSong(item) {
    const { error } = await supabase.from('setlist_items').delete().eq('id', item.id);
    if (error) {
      notify("Couldn't remove song: " + error.message);
      return;
    }
    loadSetlists();
  }

  // Optimistic reorder: update the on-screen order immediately (no network
  // wait, no reload) so dragging feels instant, then persist positions in
  // the background. A full reload() here -- the old approach -- flips the
  // whole Setlist section back to "Loading…" and re-renders it from
  // scratch, which is what made letting go of a drag feel like a page
  // refresh and reset the scroll position to the top of the section
  // instead of staying where you dropped it. Reverts and reports the error
  // if the background save genuinely fails.
  async function handleReorderSongs(setlistId, reorderedItems) {
    const previousSetlists = bandSetlists;
    setBandSetlists((prev) =>
      prev.map((sl) => (sl.id === setlistId ? { ...sl, setlist_items: reorderedItems } : sl))
    );

    const { error } = await supabase.from('setlist_items').upsert(
      reorderedItems.map((item, idx) => ({
        id: item.id,
        setlist_id: setlistId,
        song_id: item.song_id,
        position: idx + 1,
      }))
    );
    if (error) {
      notify("Couldn't save the new song order: " + error.message);
      setBandSetlists(previousSetlists);
    }
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

  // Same reasoning as handleReorderSongs above -- only blank out on the true
  // initial load, not every refetch after a song edit saves, or the whole
  // section unmounts down to a one-line message and back, resetting scroll.
  if (loading && bandSetlists.length === 0) return <p className="state-message">Loading setlist…</p>;

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
          isAdmin={canManage}
          canMakePublic={isAdmin}
          onAddSong={handleAddSong}
          onRemoveSong={handleRemoveSong}
          onReorder={handleReorderSongs}
          onDetach={() => handleDetach(setlist.id)}
          onDeleteTemplate={() => handleDeleteTemplate(setlist)}
          reload={loadSetlists}
        />
      ))}

      {canManage && (
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

          {!showImport ? (
            <button type="button" className="link-button" style={{ marginTop: 10 }} onClick={() => setShowImport(true)}>
              📋 Or paste a setlist from a singer/band
            </button>
          ) : (
            <div style={{ marginTop: 12 }}>
              <ImportSetlist
                bandId={bandId}
                gigId={gigId}
                allSongs={songs}
                newSongCreatedBy={isAdmin ? null : profile?.id}
                onImported={() => { setShowImport(false); loadSetlists(); loadSongs(); }}
                onCancel={() => setShowImport(false)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SetlistBlock({ setlist, songs, isAdmin, canMakePublic, onAddSong, onRemoveSong, onReorder, onDetach, onDeleteTemplate, reload }) {
  const [pickedSongId, setPickedSongId] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [editingItemId, setEditingItemId] = useState(null);
  const [showLyricsId, setShowLyricsId] = useState(null);
  const [showPlayerId, setShowPlayerId] = useState(null);
  const [activeId, setActiveId] = useState(null);

  function handleAdd(e) {
    e.preventDefault();
    onAddSong(setlist, pickedSongId || null, newTitle);
    setPickedSongId('');
    setNewTitle('');
  }

  // distance:4 lets a tap on the handle register as a tap (opening nothing,
  // since the handle has no click action) rather than every touch briefly
  // registering as a drag -- and, combined with touch-action:none on the
  // handle itself below, is what makes this feel like an app drag instead
  // of fighting the page's own touch-scroll.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const activeItem = activeId ? setlist.setlist_items.find((i) => i.id === activeId) : null;

  function handleDragStart(event) {
    setActiveId(event.active.id);
  }
  function handleDragEnd(event) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id || !isAdmin) return;
    const oldIndex = setlist.setlist_items.findIndex((i) => i.id === active.id);
    const newIndex = setlist.setlist_items.findIndex((i) => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    onReorder(setlist.id, arrayMove(setlist.setlist_items, oldIndex, newIndex));
  }

  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(setlist.name);

  async function handleRename(e) {
    e.preventDefault();
    if (!renameValue.trim()) return;
    const { error } = await supabase.from('setlists').update({ name: renameValue }).eq('id', setlist.id);
    if (error) {
      notify("Couldn't rename set: " + error.message);
      return;
    }
    setRenaming(false);
    reload();
  }

  return (
    <div className="setlist-block">
      <div className="section-header">
        {renaming ? (
          <form onSubmit={handleRename} style={{ display: 'flex', gap: 8, flex: 1 }}>
            <input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus style={{ flex: 1, padding: '4px 8px', border: '1px solid var(--line)', borderRadius: 6 }} />
            <button type="submit" className="btn btn--primary btn--small">Save</button>
            <button type="button" className="btn btn--ghost btn--small" onClick={() => setRenaming(false)}>Cancel</button>
          </form>
        ) : (
          <h4 className="section-header__title" style={{ fontSize: 15 }} onDoubleClick={() => setRenaming(true)} title="Double-click to rename">{setlist.name}</h4>
        )}
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
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <SortableContext items={setlist.setlist_items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            <ol className="setlist-block__songs">
              {setlist.setlist_items.map((item, idx) => (
                <SortableSongItem
                  key={item.id}
                  item={item}
                  idx={idx}
                  isAdmin={isAdmin}
                  canMakePublic={canMakePublic}
                  isEditing={editingItemId === item.id}
                  showPlayerId={showPlayerId}
                  showLyricsId={showLyricsId}
                  onRemoveSong={onRemoveSong}
                  setShowPlayerId={setShowPlayerId}
                  setShowLyricsId={setShowLyricsId}
                  setEditingItemId={setEditingItemId}
                  reload={reload}
                />
              ))}
            </ol>
          </SortableContext>
          <DragOverlay>
            {activeItem ? <SongRowPreview item={activeItem} /> : null}
          </DragOverlay>
        </DndContext>
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

function SortableSongItem({
  item, idx, isAdmin, canMakePublic, isEditing, showPlayerId, showLyricsId,
  onRemoveSong, setShowPlayerId, setShowLyricsId, setEditingItemId, reload,
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const song = item.songs;

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <li ref={setNodeRef} style={style} className="setlist-song">
      <div className="setlist-song__row">
        <div className="setlist-song__main">
          <span
            className="setlist-song__handle"
            title={isAdmin ? 'Drag to reorder' : undefined}
            style={{ touchAction: 'none', cursor: isAdmin ? 'grab' : 'default' }}
            {...(isAdmin ? attributes : {})}
            {...(isAdmin ? listeners : {})}
          >
            ⠿
          </span>
          <span className="setlist-song__number">{idx + 1}</span>
          <span className="setlist-song__title">
            {song ? song.title : <em style={{ color: 'var(--text-muted)' }}>Song details unavailable</em>}
            {song?.original_key ? <span className="setlist-song__key">{song.original_key}</span> : null}
          </span>
        </div>
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
          {song && (
            <button className="link-button" onClick={() => setEditingItemId(isEditing ? null : item.id)}>
              {isEditing ? 'Close' : 'Edit'}
            </button>
          )}
          <button className="link-button link-button--danger" onClick={() => onRemoveSong(item)}>×</button>
        </div>
      </div>

      {isEditing && song && (
        <SongEditFields
          song={song}
          canMakePublic={canMakePublic}
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
}

// Static floating preview shown under the pointer/finger while dragging --
// deliberately simplified (no action buttons, no expandable lyrics/player)
// since it's a transient visual stand-in for the row, not an interactive one.
function SongRowPreview({ item }) {
  const song = item.songs;
  return (
    <li className="setlist-song setlist-song--overlay">
      <div className="setlist-song__row">
        <div className="setlist-song__main">
          <span className="setlist-song__handle" style={{ cursor: 'grabbing' }}>⠿</span>
          <span className="setlist-song__title">
            {song ? song.title : 'Song details unavailable'}
            {song?.original_key ? <span className="setlist-song__key">{song.original_key}</span> : null}
          </span>
        </div>
      </div>
    </li>
  );
}

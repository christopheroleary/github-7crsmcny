import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useCurrentProfile } from '../context/ProfileContext.jsx';
import { useIsOffline } from '../hooks/useIsOffline.js';
import { isLikelyOfflineError } from '../utils/networkError.js';
import CollapsibleSection from './CollapsibleSection.jsx';
import InfoTooltip from './InfoTooltip.jsx';
// Reused outright, not redrawn -- same "songs" concept as the Repertoire
// nav tab, so this section gets the exact same glyph rather than a second,
// slightly-different one.
import { RepertoireIcon } from '../utils/tabIcons.jsx';
import ImportSetlist from './ImportSetlist.jsx';
import SongEditFields from './SongEditFields.jsx';
import { ReferencePlayer, LyricsView } from './SongReference.jsx';
import BackingTrackPlayer from './BackingTrackPlayer.jsx';
import PerformanceMode from './PerformanceMode.jsx';
import useBandBackingTrackSongIds from '../hooks/useBandBackingTrackSongIds.js';
import { confirmAsync } from '../utils/confirmService.js';
import { notify } from '../utils/toastService.js';
import { DndContext, DragOverlay, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export default function GigSetlist({ gigId, bandId, lineup = [], cachedSetlists = [], refreshSignal, defaultOpen = false }) {
  const { isAdmin, isBandLeader, profile } = useCurrentProfile();
  const canManage = isAdmin || isBandLeader;
  const [bandSetlists, setBandSetlists] = useState([]);
  const [attachedIds, setAttachedIds] = useState([]);
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [usingCache, setUsingCache] = useState(false);
  // songId -> array of display names -- who on THIS gig's roster (real
  // member or dep, confirmed or not -- still the plan either way) has
  // ticked "Lead vocal" for that song in their own repertoire. Recomputed
  // whenever the roster or the attached setlists change, not just once,
  // since either can move independently (a roster swap, a song added).
  const [vocalsBySong, setVocalsBySong] = useState({});
  const [newSetName, setNewSetName] = useState('');
  const [pickedExistingId, setPickedExistingId] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [error, setError] = useState(null);
  const [showPerformanceMode, setShowPerformanceMode] = useState(false);
  // Which songs actually have a band backing track -- the "Backing track"
  // button only shows for those, rather than unconditionally on every row.
  const { songIds: backingTrackSongIds, reload: reloadBackingTracks } = useBandBackingTrackSongIds(bandId);

  // Split from loadSongs below: attaching/detaching/reordering a setlist on
  // THIS gig never creates or renames a song, so most mutations' post-write
  // refresh only need to redo this, not the whole song catalog too.
  const loadSetlists = useCallback(async () => {
    if (!bandId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const { data: setlistRows, error: setlistsError } = await supabase
        .from('setlists')
        .select('id, name, setlist_items(id, position, song_id, songs(id, title, artist, original_key, bpm, lyrics, reference_url, is_public))')
        .eq('band_id', bandId)
        .order('name');
      if (setlistsError) throw setlistsError;

      const sorted = (setlistRows || []).map((sl) => ({
        ...sl,
        setlist_items: [...(sl.setlist_items || [])].sort((a, b) => a.position - b.position),
      }));

      const { data: links, error: linksError } = await supabase.from('gig_setlists').select('setlist_id').eq('gig_id', gigId);
      if (linksError) throw linksError;

      setBandSetlists(sorted);
      setAttachedIds((links || []).map((l) => l.setlist_id));
      setUsingCache(false);
    } catch (err) {
      // A genuinely unreachable network doesn't always resolve to
      // { data, error } the way a server-side rejection does -- fetch()
      // itself can reject, which threw here uncaught before this
      // try/catch existed, and nothing downstream ever ran, including
      // setLoading(false) at the bottom. Caught live: the setlist stuck
      // on "Loading…" with no signal, including blocking the one thing
      // that's actually available offline underneath it -- a
      // backing track already saved to this device (see
      // BackingTrackPlayer.jsx/offlineBackingTracks.js), which never got
      // a chance to render because this never got past loading.
      //
      // useOfflineGigData's cache only has the setlist(s) already
      // attached to this gig, not the band's whole library (attaching a
      // different one is a mutation that needs a connection anyway) --
      // songs() there doesn't carry a top-level song_id the way the live
      // query's embed does, so it's normalized in here.
      // A genuine (non-network) error -- a real bug, an RLS change -- is
      // surfaced honestly even when cachedSetlists exists, rather than
      // silently hiding it behind a "connection trouble" banner that would
      // misdescribe what actually happened.
      if (cachedSetlists.length > 0 && isLikelyOfflineError(err)) {
        const normalized = cachedSetlists.map((sl) => ({
          ...sl,
          setlist_items: (sl.setlist_items || []).map((item) => ({
            ...item,
            song_id: item.song_id ?? item.songs?.id ?? null,
          })),
        }));
        setBandSetlists(normalized);
        setAttachedIds(normalized.map((sl) => sl.id));
        setUsingCache(true);
      } else {
        setUsingCache(false);
        setError("Couldn't load the setlist" + (isLikelyOfflineError(err) ? ' — no signal, and nothing saved yet for this gig.' : ': ' + (err.message || 'unknown error')));
      }
    } finally {
      setLoading(false);
    }
  }, [gigId, bandId, cachedSetlists]);

  // Re-fetches the moment connectivity returns -- without this, a setlist
  // that fell back to cache stayed on that stale snapshot even once back
  // online.
  const isOffline = useIsOffline(loadSetlists);

  // The whole-catalog "add a song" picker -- not scoped to this band or gig
  // at all, so it only needs loading once per mount, plus again on the two
  // mutations that can actually add to it: typing a brand new song title in
  // handleAddSong, or importing a pasted setlist with unmatched songs.
  const loadSongs = useCallback(async () => {
    const { data: songRows } = await supabase.from('songs').select('id, title, artist').order('title');
    setSongs(songRows || []);
  }, []);

  // Cross-references this gig's roster against each singer's own ticked
  // repertoire (known_songs for a real member, placeholder_known_songs for
  // a dep) -- "can they actually sing what's on tonight's setlist", not
  // just "are they free". Deliberately every roster row, confirmed or not
  // -- a pending swap is still the plan right now. Handles the gaps
  // gracefully rather than pretending they don't exist: a real member's
  // own repertoire is only visible here at all because known_songs_select
  // now reuses can_view_profile() (see known_songs_leader_visibility
  // migration -- it used to be self-or-admin only, which silently broke
  // this same cross-reference for DepFinderWizard.jsx too); a song genuinely
  // never ticked by anyone on the roster just renders with nothing next to
  // it rather than a false "nobody can sing this".
  const loadVocalsBySong = useCallback(async () => {
    const songIds = Array.from(new Set(
      bandSetlists
        .filter((sl) => attachedIds.includes(sl.id))
        .flatMap((sl) => sl.setlist_items.map((i) => i.song_id))
    ));
    const profileRows = lineup.filter((l) => l.profile_id);
    const placeholderRows = lineup.filter((l) => l.placeholder_id);
    if (songIds.length === 0 || (profileRows.length === 0 && placeholderRows.length === 0)) {
      setVocalsBySong({});
      return;
    }

    const [{ data: known }, { data: knownPh }] = await Promise.all([
      profileRows.length > 0
        ? supabase.from('known_songs').select('profile_id, song_id')
            .eq('can_sing_lead', true).in('song_id', songIds).in('profile_id', profileRows.map((l) => l.profile_id))
        : Promise.resolve({ data: [] }),
      placeholderRows.length > 0
        ? supabase.from('placeholder_known_songs').select('placeholder_id, song_id')
            .eq('can_sing_lead', true).in('song_id', songIds).in('placeholder_id', placeholderRows.map((l) => l.placeholder_id))
        : Promise.resolve({ data: [] }),
    ]);

    const nameByProfileId = Object.fromEntries(profileRows.map((l) => [l.profile_id, l.profiles?.full_name || 'Unknown']));
    const nameByPlaceholderId = Object.fromEntries(placeholderRows.map((l) => [l.placeholder_id, l.placeholder_musicians?.name || 'Unknown']));

    const map = {};
    (known || []).forEach((r) => {
      (map[r.song_id] ??= []).push(nameByProfileId[r.profile_id]);
    });
    (knownPh || []).forEach((r) => {
      (map[r.song_id] ??= []).push(nameByPlaceholderId[r.placeholder_id]);
    });
    setVocalsBySong(map);
  }, [bandSetlists, attachedIds, lineup]);

  useEffect(() => { loadVocalsBySong(); }, [loadVocalsBySong]);

  useEffect(() => {
    loadSetlists();
    loadSongs();
    // refreshSignal is otherwise unused here -- it's a signal, not data. This
    // component keeps its own independent fetch, entirely separate from
    // GigDetail's own shared gig/lineup snapshot, so nothing else tells it to
    // refetch. GigDetail bumps this prop when the top "↻ Refresh" button is
    // clicked specifically to give this effect a reason to re-run too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadSetlists, loadSongs, refreshSignal]);

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
    <CollapsibleSection
      id="gig-section-setlist"
      title="Setlist"
      icon={<RepertoireIcon />}
      defaultOpen={defaultOpen}
      titleExtra={<InfoTooltip text="The set(s) attached to this gig from your band's library — attach an existing one, create a new one, or import a pasted list." />}
    >
      {usingCache && (
        <p className="field__hint" style={{ marginBottom: 10, color: 'var(--rust)' }}>
          {isOffline ? '● Offline' : '⚠ Connection trouble'} — showing the setlist as it was last saved to this device. Attaching, editing or reordering needs a signal; backing tracks saved for offline still play.
        </p>
      )}
      {!usingCache && error && attachedSetlists.length === 0 && (
        <p className="form-error" style={{ marginBottom: 10 }}>{error}</p>
      )}
      {attachedSetlists.length === 0 ? (
        <p className="state-message">No sets attached to this gig yet.</p>
      ) : (
        <button type="button" className="btn btn--primary btn--small" style={{ marginBottom: 12 }} onClick={() => setShowPerformanceMode(true)}>
          ▶ Performance mode
        </button>
      )}

      {showPerformanceMode && (
        <PerformanceMode
          setlists={attachedSetlists}
          bandId={bandId}
          gigId={gigId}
          backingTrackSongIds={backingTrackSongIds}
          onClose={() => setShowPerformanceMode(false)}
        />
      )}

      {attachedSetlists.map((setlist) => (
        <SetlistBlock
          key={setlist.id}
          setlist={setlist}
          songs={songs}
          vocalsBySong={vocalsBySong}
          bandId={bandId}
          gigId={gigId}
          backingTrackSongIds={backingTrackSongIds}
          onTracksChanged={reloadBackingTracks}
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
    </CollapsibleSection>
  );
}

function SetlistBlock({ setlist, songs, vocalsBySong, bandId, gigId, backingTrackSongIds, onTracksChanged, isAdmin, canMakePublic, onAddSong, onRemoveSong, onReorder, onDetach, onDeleteTemplate, reload }) {
  const [pickedSongId, setPickedSongId] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [editingItemId, setEditingItemId] = useState(null);
  const [showLyricsId, setShowLyricsId] = useState(null);
  const [showPlayerId, setShowPlayerId] = useState(null);
  const [showTrackId, setShowTrackId] = useState(null);
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
                  singers={item.song_id ? vocalsBySong[item.song_id] : undefined}
                  bandId={bandId}
                  gigId={gigId}
                  backingTrackSongIds={backingTrackSongIds}
                  onTracksChanged={onTracksChanged}
                  isAdmin={isAdmin}
                  canMakePublic={canMakePublic}
                  isEditing={editingItemId === item.id}
                  showPlayerId={showPlayerId}
                  showLyricsId={showLyricsId}
                  showTrackId={showTrackId}
                  onRemoveSong={onRemoveSong}
                  setShowPlayerId={setShowPlayerId}
                  setShowLyricsId={setShowLyricsId}
                  setShowTrackId={setShowTrackId}
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
  item, idx, singers, bandId, gigId, backingTrackSongIds, onTracksChanged, isAdmin, canMakePublic, isEditing, showPlayerId, showLyricsId, showTrackId,
  onRemoveSong, setShowPlayerId, setShowLyricsId, setShowTrackId, setEditingItemId, reload,
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
            {/* Blank when nobody on the roster has ticked "Lead vocal" for
                this song -- deliberately not a warning icon, since that's
                as likely to mean "nobody's filled their repertoire in yet"
                as "nobody can actually sing it". title carries the full,
                untruncated name list -- the tag itself stays capped. */}
            {singers && singers.length > 0 && (
              <span className="setlist-song__vocals" title={'Can sing lead: ' + singers.join(', ')}>
                🎤 {singers.join(', ')}
              </span>
            )}
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
          {song && bandId && backingTrackSongIds?.has(song.id) && (
            <button className="link-button" onClick={() => setShowTrackId(showTrackId === item.id ? null : item.id)}>
              {showTrackId === item.id ? 'Hide backing track' : 'Backing track'}
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
          bandId={bandId}
          onTracksChanged={onTracksChanged}
          onSaved={() => {
            setEditingItemId(null);
            reload();
          }}
          onCancel={() => setEditingItemId(null)}
        />
      )}

      {!isEditing && showPlayerId === item.id && <ReferencePlayer url={song?.reference_url} />}
      {!isEditing && showLyricsId === item.id && <LyricsView text={song?.lyrics} />}
      {!isEditing && showTrackId === item.id && song && bandId && (
        <BackingTrackPlayer band={{ id: bandId }} song={song} gigId={gigId} />
      )}
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

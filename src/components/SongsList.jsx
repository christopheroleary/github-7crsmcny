import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { confirmAsync } from '../utils/confirmService.js';
import { notify } from '../utils/toastService.js';
import SongEditFields from './SongEditFields.jsx';
import { ReferencePlayer, LyricsView } from './SongReference.jsx';
import SearchBox from './SearchBox.jsx';
import { useFuzzySearch } from '../hooks/useFuzzySearch.js';
import SongDuplicates from './SongDuplicates.jsx';

// Matches the stroke-icon convention used elsewhere (App.jsx's UserIcon,
// NotificationBell) rather than an emoji, which renders inconsistently
// across platforms/fonts and doesn't take a deliberate colour.
function GlobeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

// Admin-only master repertoire -- every song in the system in one place,
// quick to search and edit, rather than only reachable by drilling into
// whichever setlist happens to already contain it.
export default function SongsList() {
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [showPlayerId, setShowPlayerId] = useState(null);
  const [showLyricsId, setShowLyricsId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newArtist, setNewArtist] = useState('');
  const [newKey, setNewKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('songs').select('*').order('title');
    setSongs(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function startAdd() {
    setNewTitle('');
    setNewArtist('');
    setNewKey('');
    setError(null);
    setAdding(true);
  }

  async function handleAdd(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const { data, error: saveError } = await supabase
      .from('songs')
      .insert({ title: newTitle.trim(), artist: newArtist.trim() || null, original_key: newKey.trim() || null })
      .select()
      .single();
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    setAdding(false);
    await load();
    setEditingId(data.id);
  }

  async function handleDelete(song) {
    const ok = await confirmAsync(`Delete "${song.title}"? This cannot be undone.`);
    if (!ok) return;
    const { error: deleteError } = await supabase.from('songs').delete().eq('id', song.id);
    if (deleteError) {
      notify(
        deleteError.code === '23503'
          ? "Can't delete — this song is still used in a setlist. Remove it from every setlist first."
          : "Couldn't delete: " + deleteError.message
      );
      return;
    }
    load();
  }

  const { query, setQuery, results: filtered } = useFuzzySearch(songs, ['title', 'artist']);

  // Only blank out on the true initial load -- re-fetching after a save
  // (e.g. editing a song) keeps showing the existing list instead of
  // unmounting the whole page down to a one-line loading message and back,
  // which is what was resetting scroll position to the top on every save.
  if (loading && songs.length === 0) return <p className="state-message">Loading repertoire…</p>;

  return (
    <div>
      <div className="section-header">
        <h2 className="section-header__title">Repertoire ({songs.length})</h2>
        {!adding && (
          <button className="btn btn--primary btn--small" onClick={startAdd}>
            + Add song
          </button>
        )}
      </div>

      {adding && (
        <form onSubmit={handleAdd} className="inline-subform" style={{ marginBottom: 16 }}>
          <input placeholder="Title" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} required autoFocus />
          <input placeholder="Artist" value={newArtist} onChange={(e) => setNewArtist(e.target.value)} />
          <input placeholder="Key (e.g. G)" value={newKey} onChange={(e) => setNewKey(e.target.value)} style={{ maxWidth: 100 }} />
          {error && <p className="form-error">{error}</p>}
          <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
            <button type="button" className="btn btn--ghost btn--small" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary btn--small" disabled={saving}>
              {saving ? 'Saving…' : 'Save song'}
            </button>
          </div>
        </form>
      )}

      <div style={{ marginBottom: 16 }}>
        <SongDuplicates onMerged={load} />
      </div>

      {songs.length > 5 && (
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Search repertoire…"
          resultCount={filtered.length}
          totalCount={songs.length}
        />
      )}

      {songs.length === 0 && <p className="state-message">No songs yet — add one above.</p>}
      {songs.length > 0 && filtered.length === 0 && <p className="state-message">No songs match "{query}".</p>}

      <ul className="simple-list">
        {filtered.map((song) => (
          <li className="simple-list__item" key={song.id}>
            {editingId === song.id ? (
              <SongEditFields
                song={song}
                canMakePublic
                onSaved={() => { setEditingId(null); load(); }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <>
                <div className="simple-list__row">
                  <div>
                    <span className="simple-list__title">
                      {song.is_public && (
                        <span
                          title="Shared with all bands"
                          aria-label="Shared with all bands"
                          style={{ display: 'inline-flex', verticalAlign: -2, marginRight: 6, color: 'var(--teal)' }}
                        >
                          <GlobeIcon />
                        </span>
                      )}
                      {song.title}
                      {song.original_key && (
                        <span className="status-tag" style={{ marginLeft: 8, background: 'rgba(107,99,87,0.12)', color: 'var(--text-muted)', textTransform: 'none' }}>
                          {song.original_key}
                        </span>
                      )}
                    </span>
                    <span className="simple-list__subtitle">{song.artist || '—'}</span>
                  </div>
                  <div className="simple-list__actions">
                    {song.reference_url && (
                      <button className="link-button" onClick={() => setShowPlayerId(showPlayerId === song.id ? null : song.id)}>
                        {showPlayerId === song.id ? 'Hide player' : 'Listen'}
                      </button>
                    )}
                    {song.lyrics && (
                      <button className="link-button" onClick={() => setShowLyricsId(showLyricsId === song.id ? null : song.id)}>
                        {showLyricsId === song.id ? 'Hide lyrics' : 'Lyrics'}
                      </button>
                    )}
                    <button className="link-button" onClick={() => setEditingId(song.id)}>Edit</button>
                    <button className="link-button link-button--danger" onClick={() => handleDelete(song)}>Delete</button>
                  </div>
                </div>
                {showPlayerId === song.id && <ReferencePlayer url={song.reference_url} />}
                {showLyricsId === song.id && <LyricsView text={song.lyrics} />}
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

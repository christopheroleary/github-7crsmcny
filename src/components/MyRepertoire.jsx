import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { notify } from '../utils/toastService.js';
import SearchBox from './SearchBox.jsx';
import { useFuzzySearch } from '../hooks/useFuzzySearch.js';
import InfoTooltip from './InfoTooltip.jsx';

// Reused for both the musician's own profile page and the admin's per-
// musician view, same convention as MyAvailability/MyMileage. Scoped to
// public (shared) songs only -- these are what the admin-side dep-finder
// wizard can actually match a gig's setlist against, since a private
// band's own songs aren't visible outside that band anyway.
export default function MyRepertoire({ profileId }) {
  const [songs, setSongs] = useState([]);
  const [knownIds, setKnownIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: songData }, { data: known }] = await Promise.all([
      supabase.from('songs').select('id, title, artist, original_key').eq('is_public', true).order('title'),
      supabase.from('known_songs').select('song_id').eq('profile_id', profileId),
    ]);
    setSongs(songData || []);
    setKnownIds(new Set((known || []).map((k) => k.song_id)));
    setLoading(false);
  }, [profileId]);

  useEffect(() => { load(); }, [load]);

  async function toggleKnown(song) {
    const isKnown = knownIds.has(song.id);
    setSavingId(song.id);
    setKnownIds((prev) => {
      const next = new Set(prev);
      if (isKnown) next.delete(song.id); else next.add(song.id);
      return next;
    });

    const { error } = isKnown
      ? await supabase.from('known_songs').delete().eq('profile_id', profileId).eq('song_id', song.id)
      : await supabase.from('known_songs').insert({ profile_id: profileId, song_id: song.id });

    setSavingId(null);
    if (error) {
      setKnownIds((prev) => {
        const next = new Set(prev);
        if (isKnown) next.add(song.id); else next.delete(song.id);
        return next;
      });
      notify("Couldn't save: " + error.message);
    }
  }

  const { query, setQuery, results: filtered } = useFuzzySearch(songs, ['title', 'artist']);

  if (loading) return null;

  return (
    <div className="day-sheet__section">
      <h3 className="day-sheet__section-title">
        Songs I know
        <InfoTooltip text="Tick every public song you can play. Admin uses this to find a dep who already knows a gig's setlist, not just someone free that day." />
      </h3>
      <p className="field__hint" style={{ marginBottom: 12 }}>
        {knownIds.size} of {songs.length} public songs ticked.
      </p>

      {songs.length === 0 && <p className="field__hint">No public songs in the repertoire yet.</p>}

      {songs.length > 5 && (
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Search songs…"
          resultCount={filtered.length}
          totalCount={songs.length}
        />
      )}

      {songs.length > 0 && filtered.length === 0 && <p className="field__hint">No songs match "{query}".</p>}

      {filtered.length > 0 && (
        <ul className="simple-list" style={{ marginTop: 8, maxHeight: 400, overflowY: 'auto' }}>
          {filtered.map((song) => {
            const known = knownIds.has(song.id);
            return (
              <li className="simple-list__item" key={song.id}>
                <label className="simple-list__row" style={{ cursor: 'pointer', alignItems: 'center' }}>
                  <div>
                    <span className="simple-list__title">
                      {song.title}
                      {song.original_key && (
                        <span className="status-tag" style={{ marginLeft: 8, background: 'rgba(107,99,87,0.12)', color: 'var(--text-muted)' }}>
                          {song.original_key}
                        </span>
                      )}
                    </span>
                    <span className="simple-list__subtitle">{song.artist || '—'}</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={known}
                    disabled={savingId === song.id}
                    onChange={() => toggleKnown(song)}
                    style={{ width: 20, height: 20 }}
                  />
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

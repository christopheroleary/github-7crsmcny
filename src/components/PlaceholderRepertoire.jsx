import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { notify } from '../utils/toastService.js';
import SearchBox from './SearchBox.jsx';
import { useFuzzySearch } from '../hooks/useFuzzySearch.js';

// Same idea as MyRepertoire.jsx, but for a placeholder dep -- they have no
// login and can't self-report, so whoever manages this dep (admin or the
// band leader who added them) ticks it on their behalf instead.
export default function PlaceholderRepertoire({ placeholderId }) {
  const [songs, setSongs] = useState([]);
  const [knownIds, setKnownIds] = useState(new Set());
  const [leadIds, setLeadIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: songData }, { data: known }] = await Promise.all([
      supabase.from('songs').select('id, title, artist, original_key').eq('is_public', true).order('title'),
      supabase.from('placeholder_known_songs').select('song_id, can_sing_lead').eq('placeholder_id', placeholderId),
    ]);
    setSongs(songData || []);
    setKnownIds(new Set((known || []).map((k) => k.song_id)));
    setLeadIds(new Set((known || []).filter((k) => k.can_sing_lead).map((k) => k.song_id)));
    setLoading(false);
  }, [placeholderId]);

  useEffect(() => { load(); }, [load]);

  async function toggleKnown(song) {
    const isKnown = knownIds.has(song.id);
    const wasLead = leadIds.has(song.id);
    setSavingId(song.id);
    setKnownIds((prev) => {
      const next = new Set(prev);
      if (isKnown) next.delete(song.id); else next.add(song.id);
      return next;
    });
    if (isKnown && wasLead) {
      setLeadIds((prev) => { const next = new Set(prev); next.delete(song.id); return next; });
    }

    const { error } = isKnown
      ? await supabase.from('placeholder_known_songs').delete().eq('placeholder_id', placeholderId).eq('song_id', song.id)
      : await supabase.from('placeholder_known_songs').insert({ placeholder_id: placeholderId, song_id: song.id });

    setSavingId(null);
    if (error) {
      setKnownIds((prev) => {
        const next = new Set(prev);
        if (isKnown) next.add(song.id); else next.delete(song.id);
        return next;
      });
      if (isKnown && wasLead) {
        setLeadIds((prev) => { const next = new Set(prev); next.add(song.id); return next; });
      }
      notify("Couldn't save: " + error.message);
    }
  }

  async function toggleLead(song) {
    const isLead = leadIds.has(song.id);
    const wasKnown = knownIds.has(song.id);
    setSavingId(song.id);
    setLeadIds((prev) => {
      const next = new Set(prev);
      if (isLead) next.delete(song.id); else next.add(song.id);
      return next;
    });
    if (!isLead && !wasKnown) {
      setKnownIds((prev) => { const next = new Set(prev); next.add(song.id); return next; });
    }

    const { error } = await supabase
      .from('placeholder_known_songs')
      .upsert({ placeholder_id: placeholderId, song_id: song.id, can_sing_lead: !isLead }, { onConflict: 'placeholder_id,song_id' });

    setSavingId(null);
    if (error) {
      setLeadIds((prev) => {
        const next = new Set(prev);
        if (isLead) next.add(song.id); else next.delete(song.id);
        return next;
      });
      if (!isLead && !wasKnown) {
        setKnownIds((prev) => { const next = new Set(prev); next.delete(song.id); return next; });
      }
      notify("Couldn't save: " + error.message);
    }
  }

  const { query, setQuery, results: filtered } = useFuzzySearch(songs, ['title', 'artist']);

  if (loading) return null;

  return (
    <div style={{ marginTop: 8, padding: 10, border: '1px solid var(--line)', borderRadius: 8, background: 'var(--paper-raised)' }}>
      <p className="field__hint" style={{ marginBottom: 8 }}>
        {knownIds.size} of {songs.length} public songs ticked, {leadIds.size} as lead vocal — used by the dep-finder wizard to match a gig's setlist.
      </p>
      {songs.length > 5 && (
        <SearchBox value={query} onChange={setQuery} placeholder="Search songs…" resultCount={filtered.length} totalCount={songs.length} />
      )}
      <ul className="simple-list" style={{ marginTop: 8, maxHeight: 260, overflowY: 'auto' }}>
        {filtered.map((song) => {
          const known = knownIds.has(song.id);
          const lead = leadIds.has(song.id);
          return (
            <li className="simple-list__item" key={song.id} style={{ padding: '6px 10px' }}>
              <div className="simple-list__row" style={{ alignItems: 'center' }}>
                <span className="simple-list__title" style={{ fontSize: 14 }}>
                  {song.title}
                  {song.original_key && (
                    <span className="status-tag" style={{ marginLeft: 8, background: 'rgba(107,99,87,0.12)', color: 'var(--text-muted)', textTransform: 'none' }}>
                      {song.original_key}
                    </span>
                  )}
                </span>
                <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
                  <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, cursor: 'pointer', fontSize: 10, color: 'var(--text-muted)' }}>
                    Play
                    <input
                      type="checkbox"
                      checked={known}
                      disabled={savingId === song.id}
                      onChange={() => toggleKnown(song)}
                      style={{ width: 18, height: 18 }}
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, cursor: 'pointer', fontSize: 10, color: 'var(--text-muted)' }}>
                    Lead vocal
                    <input
                      type="checkbox"
                      checked={lead}
                      disabled={savingId === song.id}
                      onChange={() => toggleLead(song)}
                      style={{ width: 18, height: 18 }}
                    />
                  </label>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

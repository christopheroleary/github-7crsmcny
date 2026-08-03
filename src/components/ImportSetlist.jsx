import { useState, useMemo } from 'react';
import Fuse from 'fuse.js';
import { supabase } from '../supabaseClient';
import { parseSongList } from '../utils/parseSongList.js';

// Below this Fuse score (0 = perfect match, 1 = totally dissimilar) a parsed
// line is auto-matched to an existing song; above it, the row defaults to
// "create new song" but the reviewer can still pick an existing one by hand.
const MATCH_THRESHOLD = 0.4;
// Looser cutoff for *suggesting* an existing song without auto-picking it --
// surfaces near-misses (different wording, a genuinely ambiguous duplicate)
// in the dropdown's "Possible matches" group so they're easy to spot instead
// of buried alphabetically among every other song in the library.
const SUGGEST_THRESHOLD = 0.6;
// If the best and second-best candidate are both confident matches and
// within this of each other, don't silently auto-pick either one -- e.g. the
// library having both "Mr Brightside" and "Mr Brightside — The Killers".
const AMBIGUOUS_DELTA = 0.15;

// Apostrophes are the single biggest source of otherwise-identical titles
// missing each other -- a pasted list missing one entirely ("Im A
// Believer"), or using a curly quote from being typed/autocorrected on a
// phone ("Don’t") where the library has a straight one ("Don't"). Stripping
// them entirely (rather than trying to normalise to one style) makes both
// sides collapse to the same comparable text either way.
function normalizeForMatch(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[‘’`´']/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Fuse's character-level fuzzy matching is good at typos and near-identical
// spellings, but scores mid-string word insertions harshly -- "Bet That You
// Look Good Dancefloor" vs the library's "...On The Dance Floor" scores a
// poor ~0.63 from Fuse alone (worse than plain edit distance), so it never
// surfaced as a suggestion at all. Whole-word (token) overlap catches that
// case well without the false-positive risk plain character edit-distance
// has on short strings (which would otherwise conflate "Staceys Mum"/
// "Stacy's Mom" or even "Wonderwall"/"Wonderful"). Taking whichever of the
// two scores is better catches more real matches without weakening either
// one's own blind spots.
const STOPWORDS = new Set(['a', 'an', 'the', 'on', 'in', 'to', 'of', 'and']);

function tokenize(normalizedText) {
  return (normalizedText || '').split(' ').filter((t) => t && !STOPWORDS.has(t));
}

function tokenSetDistance(normA, normB) {
  const a = new Set(tokenize(normA));
  const b = new Set(tokenize(normB));
  if (a.size === 0 || b.size === 0) return 1;
  const intersection = [...a].filter((t) => b.has(t)).length;
  const union = new Set([...a, ...b]).size;
  return 1 - intersection / union;
}

export default function ImportSetlist({ bandId, gigId, allSongs, newSongCreatedBy, onImported, onCancel }) {
  const [rawText, setRawText] = useState('');
  const [parsed, setParsed] = useState(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState(null);

  const songsForMatching = useMemo(
    () =>
      allSongs.map((s) => ({
        ...s,
        _normTitle: normalizeForMatch(s.title),
        _normArtist: normalizeForMatch(s.artist || ''),
        _normFull: normalizeForMatch(s.title + ' ' + (s.artist || '')),
      })),
    [allSongs]
  );

  // threshold: 1 means "return every song, ranked" -- SUGGEST_THRESHOLD and
  // MATCH_THRESHOLD are applied explicitly below instead of letting Fuse
  // silently drop candidates before the token-distance blend ever runs.
  const fuse = useMemo(
    () => new Fuse(songsForMatching, { keys: ['_normTitle', '_normArtist'], threshold: 1, ignoreLocation: true, includeScore: true }),
    [songsForMatching]
  );

  function handleParse() {
    const items = parseSongList(rawText);
    const withMatches = items.map((item) => {
      const query = normalizeForMatch([item.title, item.artist].filter(Boolean).join(' '));
      const fuseResults = fuse.search(query);

      // Auto-match and ambiguity stay strictly on Fuse's own char-level score
      // -- deliberately not loosened by the token blend below, which is only
      // for surfacing suggestions, not for silently picking one.
      const best = fuseResults[0];
      const secondBest = fuseResults[1];
      const ambiguous = Boolean(
        best && secondBest &&
        best.score <= MATCH_THRESHOLD && secondBest.score <= MATCH_THRESHOLD &&
        (secondBest.score - best.score) < AMBIGUOUS_DELTA
      );
      const matchedSongId = best && !ambiguous && best.score <= MATCH_THRESHOLD ? best.item.id : '';

      const candidates = fuseResults
        .map((r) => ({ ...r, combined: Math.min(r.score, tokenSetDistance(query, r.item._normFull)) }))
        .filter((r) => r.combined <= SUGGEST_THRESHOLD)
        .sort((a, b) => a.combined - b.combined)
        .slice(0, 5)
        .map((r) => ({ id: r.item.id, title: r.item.title, artist: r.item.artist }));

      return { ...item, matchedSongId, candidates, ambiguous, skip: false };
    });
    setParsed(withMatches);
  }

  function updateItem(index, patch) {
    setParsed((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }

  // Groups by detected section, in first-seen order, falling back to a
  // single group when the paste had no section headers at all.
  const sections = useMemo(() => {
    if (!parsed) return [];
    const map = new Map();
    parsed.forEach((item, index) => {
      const key = item.section || 'Imported set';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(index);
    });
    return Array.from(map.entries());
  }, [parsed]);

  async function handleImport() {
    if (!parsed) return;
    setImporting(true);
    setError(null);
    try {
      for (const [sectionName, indices] of sections) {
        const activeIndices = indices.filter((i) => !parsed[i].skip);
        if (activeIndices.length === 0) continue;

        // Reuse a set of this name already attached to this gig rather than
        // creating a duplicate -- e.g. re-running an import of the same
        // paste (after navigating back, or doing it again next day) would
        // otherwise leave two identical "Set 1"s attached to one gig.
        let setlistId = null;
        let startPosition = 0;
        const { data: sameNameSetlists } = await supabase
          .from('setlists')
          .select('id')
          .eq('band_id', bandId)
          .eq('name', sectionName);
        if (sameNameSetlists && sameNameSetlists.length > 0) {
          const { data: attachedRows } = await supabase
            .from('gig_setlists')
            .select('setlist_id')
            .eq('gig_id', gigId)
            .in('setlist_id', sameNameSetlists.map((s) => s.id));
          if (attachedRows && attachedRows.length > 0) {
            setlistId = attachedRows[0].setlist_id;
            const { data: existingItems } = await supabase
              .from('setlist_items')
              .select('position')
              .eq('setlist_id', setlistId)
              .order('position', { ascending: false })
              .limit(1);
            startPosition = existingItems?.[0]?.position || 0;
          }
        }

        if (!setlistId) {
          const { data: newSetlist, error: setlistError } = await supabase
            .from('setlists')
            .insert({ band_id: bandId, name: sectionName })
            .select()
            .single();
          if (setlistError) throw setlistError;
          setlistId = newSetlist.id;

          const { error: attachError } = await supabase
            .from('gig_setlists')
            .insert({ gig_id: gigId, setlist_id: setlistId });
          if (attachError) throw attachError;
        }

        const needsNewSong = activeIndices.filter((i) => !parsed[i].matchedSongId);
        let createdSongs = [];
        if (needsNewSong.length > 0) {
          const { data, error: songsError } = await supabase
            .from('songs')
            .insert(
              needsNewSong.map((i) => ({
                title: parsed[i].title,
                artist: parsed[i].artist || null,
                created_by: newSongCreatedBy,
              }))
            )
            .select();
          if (songsError) throw songsError;
          createdSongs = data;
        }
        const createdSongIdByIndex = new Map(needsNewSong.map((i, idx) => [i, createdSongs[idx]?.id]));

        const itemsToInsert = activeIndices.map((i, pos) => ({
          setlist_id: setlistId,
          song_id: parsed[i].matchedSongId || createdSongIdByIndex.get(i),
          position: startPosition + pos + 1,
        }));

        const { error: itemsError } = await supabase.from('setlist_items').insert(itemsToInsert);
        if (itemsError) throw itemsError;
      }
      onImported();
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  }

  if (!parsed) {
    return (
      <div className="inline-subform">
        <textarea
          rows={10}
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          placeholder={
            'Paste a setlist here, e.g.\n\nSET 1\n1. Mr Brightside - The Killers\n2. Valerie (Amy Winehouse)\n\nENCORE\nSweet Caroline'
          }
        />
        <div className="form-actions">
          <button type="button" className="btn btn--ghost btn--small" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn--primary btn--small" onClick={handleParse} disabled={!rawText.trim()}>
            Parse setlist
          </button>
        </div>
      </div>
    );
  }

  const totalActive = parsed.filter((it) => !it.skip).length;

  return (
    <div className="inline-subform">
      <p className="field__hint">
        Found {totalActive} song{totalActive === 1 ? '' : 's'} across {sections.length} set{sections.length === 1 ? '' : 's'}.
        Review the matches below, fix anything that split wrong, then import.
      </p>

      {sections.map(([sectionName, indices]) => (
        <div key={sectionName} style={{ marginTop: 16 }}>
          <h4 className="section-header__title" style={{ fontSize: 15, marginBottom: 8 }}>{sectionName}</h4>
          {indices.map((i) => {
            const item = parsed[i];
            const candidateIds = new Set(item.candidates.map((c) => c.id));
            const otherSongs = allSongs.filter((s) => !candidateIds.has(s.id));
            return (
              <div key={i}>
                <div className="field-row" style={{ opacity: item.skip ? 0.5 : 1, marginBottom: item.ambiguous ? 2 : 8, alignItems: 'center' }}>
                  <input
                    value={item.title}
                    onChange={(e) => updateItem(i, { title: e.target.value })}
                    disabled={item.skip}
                    style={{ flex: 2 }}
                  />
                  <input
                    value={item.artist}
                    onChange={(e) => updateItem(i, { artist: e.target.value })}
                    placeholder="Artist (optional)"
                    disabled={item.skip}
                    style={{ flex: 1 }}
                  />
                  <select
                    value={item.matchedSongId}
                    onChange={(e) => updateItem(i, { matchedSongId: e.target.value })}
                    disabled={item.skip}
                    style={{ flex: 2 }}
                  >
                    <option value="">+ Create new song</option>
                    {item.candidates.length > 0 && (
                      <optgroup label="Possible matches">
                        {item.candidates.map((c) => (
                          <option key={c.id} value={c.id}>{c.title}{c.artist ? ' — ' + c.artist : ''}</option>
                        ))}
                      </optgroup>
                    )}
                    <optgroup label={item.candidates.length > 0 ? 'All other songs' : 'All songs'}>
                      {otherSongs.map((s) => (
                        <option key={s.id} value={s.id}>{s.title}{s.artist ? ' — ' + s.artist : ''}</option>
                      ))}
                    </optgroup>
                  </select>
                  <button type="button" className="link-button link-button--danger" onClick={() => updateItem(i, { skip: !item.skip })}>
                    {item.skip ? 'Restore' : 'Remove'}
                  </button>
                </div>
                {item.ambiguous && !item.skip && (
                  <p className="field__hint" style={{ color: 'var(--rust)', margin: '0 0 8px' }}>
                    ⚠ Found more than one similar song in your library — double-check the right one is selected above.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {error && <p className="form-error">{error}</p>}

      <div className="form-actions">
        <button type="button" className="btn btn--ghost btn--small" onClick={() => setParsed(null)}>← Back to paste</button>
        <button type="button" className="btn btn--primary btn--small" onClick={handleImport} disabled={importing || totalActive === 0}>
          {importing ? 'Importing…' : `Import ${totalActive} song${totalActive === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  );
}

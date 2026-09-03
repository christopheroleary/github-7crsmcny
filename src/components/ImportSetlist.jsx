import { useState, useMemo, useCallback, memo } from 'react';
import Fuse from 'fuse.js';
import { supabase } from '../supabaseClient';
import { parseSongList } from '../utils/parseSongList.js';
import { Trash2, RotateCcw } from '../utils/stagePlotIcons.jsx';

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
        _normFull: normalizeForMatch(s.title + ' ' + (s.artist || '')),
      })),
    [allSongs]
  );

  // Search against the combined "title artist" string as a single Fuse key,
  // not title and artist as two separate keys -- caught live: a clean,
  // unambiguous paste like "Africa - Toto" scored ~0.54 (above
  // MATCH_THRESHOLD, so not auto-matched) against two short separate
  // fields, because Fuse's per-key scoring penalises a query that only
  // partially overlaps EACH field even when the two fields together
  // account for the whole query. Against one combined field the same
  // query scores ~0.03 -- correctly confident. Verified this doesn't
  // regress the cases the two-field split was presumably for: a
  // title-only paste ("Sweet Caroline") still scores ~0.03 against the
  // longer combined field, and true near-duplicates ("Mr Brightside" vs
  // "Mr. Brightside") still tie exactly, so the ambiguous check below
  // still catches them rather than either key change picking one blindly.
  //
  // threshold: 1 means "return every song, ranked" -- SUGGEST_THRESHOLD and
  // MATCH_THRESHOLD are applied explicitly below instead of letting Fuse
  // silently drop candidates before the token-distance blend ever runs.
  const fuse = useMemo(
    () => new Fuse(songsForMatching, { keys: ['_normFull'], threshold: 1, ignoreLocation: true, includeScore: true }),
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
      const confidentMatch = Boolean(best && !ambiguous && best.score <= MATCH_THRESHOLD);

      const candidates = fuseResults
        .map((r) => ({ ...r, combined: Math.min(r.score, tokenSetDistance(query, r.item._normFull)) }))
        .filter((r) => r.combined <= SUGGEST_THRESHOLD)
        .sort((a, b) => a.combined - b.combined)
        .slice(0, 5)
        .map((r) => ({ id: r.item.id, title: r.item.title, artist: r.item.artist }));

      // Colour is a scannable "how sure was the matcher" signal down a long
      // pasted list -- green needs no attention, yellow is a single guess
      // (a lone suggestion, or none at all -- both are the matcher making a
      // call with nothing to cross-check against), orange is where a human
      // decision actually matters because more than one candidate is
      // plausible. Green always wins over orange even when a confident
      // match also happens to have weaker candidates nearby -- those don't
      // need a second look just because they showed up in the list.
      //
      // Every case with at least one candidate pre-selects the top-ranked
      // one (candidates is already sorted best-first) -- including orange,
      // where the top guess is usually still right and accepting it is a
      // glance-and-click, not a manual re-pick from the full library. The
      // colour is what still tells the reviewer "double-check this one";
      // pre-selecting doesn't mean the matcher is claiming confidence.
      let matchedSongId = '';
      let matchStatus;
      if (confidentMatch) {
        matchedSongId = best.item.id;
        matchStatus = 'green';
      } else if (candidates.length > 0) {
        matchedSongId = candidates[0].id;
        matchStatus = candidates.length > 1 ? 'orange' : 'yellow';
      } else {
        matchStatus = 'yellow';
      }

      return { ...item, matchedSongId, candidates, ambiguous, matchStatus, skip: false };
    });
    setParsed(withMatches);
  }

  // Stable identity (setParsed itself never changes) so ImportRow's
  // React.memo actually holds -- an inline function here would give every
  // row a "new" onChange/onClick prop every render, defeating the memo and
  // putting us right back to rebuilding all ~230 <option> tags per row on
  // every keystroke in any one of them. See ImportRow below.
  const updateItem = useCallback((index, patch) => {
    setParsed((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }, []);

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
          {indices.map((i) => (
            <ImportRow key={i} index={i} item={parsed[i]} allSongs={allSongs} onUpdate={updateItem} />
          ))}
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

// A pasted setlist can run to 40-50 rows, and the band's whole song
// catalogue (allSongs, shared across every band -- see loadSongs in
// GigSetlist.jsx) can run into the hundreds -- every row's <select> holds
// nearly the whole catalogue as options. Un-memoized, editing any ONE
// row's title/artist/skip re-rendered the entire list: every other row
// recomputed its "songs not already suggested" filter and rebuilt its full
// option list from scratch, an O(rows × catalogue) cost paid again on
// every keystroke anywhere in the form -- caught live as the dropdown
// itself feeling slow to open, since that's the moment a re-render is
// most likely to still be catching up. React.memo plus the stable
// onUpdate callback above means a change to one row only re-renders that
// row; otherSongs is memoized too, so it's computed once per row instead
// of once per row per keystroke anywhere in the form.
// One line per status, doubling as the "why is this coloured like this"
// explanation color alone can't carry -- the single-candidate and
// no-candidate cases share a colour (both are the matcher making an
// unchecked call) but need different words, since one is a guess sitting
// in the box and the other is "create new song" left as-is.
const MATCH_LABELS = {
  green: 'Matched',
  yellow: (hasGuess) => (hasGuess ? 'Best guess — check it' : 'No match — new song'),
  orange: 'Multiple matches — check it',
};

const ImportRow = memo(function ImportRow({ index, item, allSongs, onUpdate }) {
  const otherSongs = useMemo(() => {
    const candidateIds = new Set(item.candidates.map((c) => c.id));
    return allSongs.filter((s) => !candidateIds.has(s.id));
  }, [item.candidates, allSongs]);

  const label = item.matchStatus === 'yellow' ? MATCH_LABELS.yellow(item.candidates.length > 0) : MATCH_LABELS[item.matchStatus];

  return (
    <div className="import-row" style={{ opacity: item.skip ? 0.5 : 1 }}>
      <div className="import-row__top">
        <input
          value={item.title}
          onChange={(e) => onUpdate(index, { title: e.target.value })}
          disabled={item.skip}
          style={{ flex: 2 }}
        />
        <input
          value={item.artist}
          onChange={(e) => onUpdate(index, { artist: e.target.value })}
          placeholder="Artist (optional)"
          disabled={item.skip}
          style={{ flex: 1 }}
        />
        <button
          type="button"
          className="link-button link-button--danger import-row__trash"
          onClick={() => onUpdate(index, { skip: !item.skip })}
          title={item.skip ? 'Restore' : 'Remove'}
          aria-label={item.skip ? 'Restore song' : 'Remove song'}
        >
          {item.skip ? <RotateCcw size={14} /> : <Trash2 size={14} />}
        </button>
      </div>
      <div className="import-row__match">
        <span className={'import-match-label import-match-label--' + item.matchStatus}>{label}</span>
        <select
          value={item.matchedSongId}
          onChange={(e) => onUpdate(index, { matchedSongId: e.target.value })}
          disabled={item.skip}
          className={'import-match-select import-match-select--' + item.matchStatus}
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
      </div>
      {item.matchStatus === 'orange' && !item.skip && (
        <p className="field__hint" style={{ color: 'var(--rust)', margin: '6px 0 0' }}>
          ⚠ Found more than one similar song in your library — double-check the right one is selected above.
        </p>
      )}
    </div>
  );
});

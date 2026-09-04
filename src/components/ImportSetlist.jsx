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
// How much the combined title+artist score is allowed to *improve* (never
// worsen) a song's title-only score -- see the comment above `scoreSongs`
// for why this is bounded rather than a straight blend.
const TITLE_TIEBREAK_BAND = 0.1;

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
        _normFull: normalizeForMatch(s.title + ' ' + (s.artist || '')),
      })),
    [allSongs]
  );

  // Two separate single-key Fuse indexes, not one combined-field index (the
  // previous approach) and not one Fuse instance with two weighted keys
  // (tried first, reverted -- see below). Title is searched and scored on
  // its own, completely independent of artist, which is what a title match
  // needs to be: "Angels" (pasted with no artist) used to score too poorly
  // against a library row of "Angels — Robbie Williams" to auto-match --
  // the combined string comparison penalised the query for not containing
  // "robbie williams" even though the title itself was a perfect match.
  // Worse, the same combined-string approach could let a completely
  // different song whose ARTIST happened to overlap the pasted artist
  // outrank the correct title match -- title is the one signal that should
  // never lose to artist-only noise, so it's scored in complete isolation
  // here; see scoreSongs below for how the two are recombined.
  //
  // threshold: SUGGEST_THRESHOLD, not 1 -- caught live: with threshold 1
  // ("return every song, ranked"), Fuse never gets to use its own Bitap
  // early-termination and instead fully scores all ~300+ catalogue songs
  // against every one of up to 150+ pasted lines, twice over (this index
  // and fuseFull below) -- measured at ~8s for a 160-song paste against a
  // 312-song catalogue, the actual cause of the import screen feeling slow
  // to open (not the <select> itself -- see the dropdown-render note on
  // ImportRow further down). Capping the threshold at SUGGEST_THRESHOLD
  // lets Fuse skip full scoring for the (vast majority of) songs nowhere
  // close to matching, with no behaviour change: anything Fuse would drop
  // for scoring worse than SUGGEST_THRESHOLD gets filtered out of
  // `candidates` immediately below anyway, and scoreSongs' own
  // Math.min(fuseScore ?? 1, tokenSetDistance(...)) already tolerates a
  // missing Fuse score by falling back to the independent token-distance
  // value, which is unaffected by Fuse's own threshold.
  const fuseTitle = useMemo(
    () => new Fuse(songsForMatching, { keys: ['_normTitle'], threshold: SUGGEST_THRESHOLD, ignoreLocation: true, includeScore: true }),
    [songsForMatching]
  );
  // Kept alongside the title-only index specifically for when title alone
  // can't tell two songs apart (two different "Angels"es) -- see
  // scoreSongs. A single Fuse instance with two *weighted* keys was tried
  // here first and reverted: Fuse's own per-key scoring penalises a query
  // that only partially overlaps EACH key even when the two keys together
  // account for the whole query (a clean, unambiguous paste like
  // "Africa - Toto" scored ~0.54 against separate weighted title/artist
  // keys -- above MATCH_THRESHOLD, so not auto-matched). Running two
  // independent single-key searches and blending the results with our own
  // bounded formula (scoreSongs) sidesteps that without giving up on
  // catching the "Africa - Toto" case, which now matches via the
  // title-only search alone (title "Africa" matches perfectly on its own,
  // no artist needed).
  const fuseFull = useMemo(
    () => new Fuse(songsForMatching, { keys: ['_normFull'], threshold: SUGGEST_THRESHOLD, ignoreLocation: true, includeScore: true }),
    [songsForMatching]
  );

  // The actual fix for the slow parse: capping Fuse's own threshold above
  // only trims which results it *returns* -- it still pays the full
  // character-level (Bitap) comparison cost against every catalogue song
  // for every parsed row regardless, measured live at ~8s for 160 rows
  // against a 312-song catalogue (an O(rows x catalogue) cost, run twice
  // over for the two indexes above). This one-time inverted index (built
  // once per catalogue load, not per row) maps each normalised word in a
  // song's title or artist to the song's index, so a parsed row can be
  // narrowed down to only the catalogue songs sharing at least one real
  // word with it -- typically a handful, not hundreds -- before Fuse ever
  // runs, turning each row's cost from O(catalogue) into O(matching
  // pool). STOPWORDS are excluded so "the"/"a" don't put half the
  // catalogue in every pool.
  const wordIndex = useMemo(() => {
    const idx = new Map();
    songsForMatching.forEach((song, i) => {
      const words = new Set([...tokenize(song._normTitle), ...tokenize(normalizeForMatch(song.artist || ''))]);
      words.forEach((w) => {
        let set = idx.get(w);
        if (!set) idx.set(w, (set = new Set()));
        set.add(i);
      });
    });
    return idx;
  }, [songsForMatching]);

  function poolIndicesFor(...normalizedStrings) {
    const out = new Set();
    normalizedStrings.forEach((s) => {
      tokenize(s).forEach((w) => {
        const hit = wordIndex.get(w);
        if (hit) hit.forEach((i) => out.add(i));
      });
    });
    return out;
  }

  // Ranks every song in the catalogue against one parsed line, title-first.
  // Title score is the primary signal and the combined title+artist score
  // can only ever *tighten* it (an artist that also agrees makes an
  // already-plausible title more confident, within TITLE_TIEBREAK_BAND) --
  // never loosen it. That asymmetry is the actual fix for both bugs this
  // was built to catch: a title-only query (or a library row missing an
  // artist) is never penalised just because the combined strings disagree,
  // and a wrong-titled song is never rescued past a bounded nudge just
  // because its artist happens to overlap the query's. Two songs that
  // genuinely share an identical title (real duplicates, or two different
  // "Angels") still tie and fall through to the ambiguous check below --
  // deliberately not resolved by artist alone, since forcing a glance-and-
  // confirm for that case is safer than guessing.
  function scoreSongs(query, normTitle) {
    // Narrow to songs sharing a real word with either the title or the
    // full query before running Fuse at all. An empty pool (zero shared
    // words anywhere in the catalogue -- e.g. a single badly-typo'd word
    // with no artist to rescue it) falls back to the full catalogue via
    // the pre-built fuseTitle/fuseFull above, rather than silently giving
    // up: that's exactly the kind of near-miss Fuse's char-level matching
    // exists to catch, and it's the rare case, not the common one.
    const poolIdx = poolIndicesFor(normTitle, query);
    const usingPool = poolIdx.size > 0;
    const pool = usingPool ? [...poolIdx].map((i) => songsForMatching[i]) : songsForMatching;

    const titleFuse = usingPool
      ? new Fuse(pool, { keys: ['_normTitle'], threshold: SUGGEST_THRESHOLD, ignoreLocation: true, includeScore: true })
      : fuseTitle;
    const fullFuse = usingPool
      ? new Fuse(pool, { keys: ['_normFull'], threshold: SUGGEST_THRESHOLD, ignoreLocation: true, includeScore: true })
      : fuseFull;
    const titleScoreById = new Map(titleFuse.search(normTitle).map((r) => [r.item.id, r.score]));
    const fullScoreById = new Map(fullFuse.search(query).map((r) => [r.item.id, r.score]));
    return pool
      .map((song) => {
        // Best-of char-level (Fuse) and whole-word (token-set) distance on
        // title alone -- the same "whichever catches it" principle the old
        // combined-field scoring used for word-reordering/insertion typos
        // ("Bet That You Look Good Dancefloor" vs "...On The Dance Floor"),
        // just scoped to title only now instead of the whole combined string.
        const titleScore = Math.min(
          titleScoreById.get(song.id) ?? 1,
          tokenSetDistance(normTitle, song._normTitle)
        );
        const fullScore = fullScoreById.get(song.id) ?? 1;
        const score = fullScore < titleScore ? Math.max(titleScore - TITLE_TIEBREAK_BAND, fullScore) : titleScore;
        return { score, item: song };
      })
      .sort((a, b) => a.score - b.score);
  }

  function handleParse() {
    const items = parseSongList(rawText);
    const withMatches = items.map((item) => {
      const normTitle = normalizeForMatch(item.title);
      const query = normalizeForMatch([item.title, item.artist].filter(Boolean).join(' '));
      const scored = scoreSongs(query, normTitle);

      const best = scored[0];
      const secondBest = scored[1];
      const ambiguous = Boolean(
        best && secondBest &&
        best.score <= MATCH_THRESHOLD && secondBest.score <= MATCH_THRESHOLD &&
        (secondBest.score - best.score) < AMBIGUOUS_DELTA
      );
      const confidentMatch = Boolean(best && !ambiguous && best.score <= MATCH_THRESHOLD);

      const candidates = scored
        .filter((r) => r.score <= SUGGEST_THRESHOLD)
        .slice(0, 5)
        .map((r) => ({ id: r.item.id, title: r.item.title, artist: r.item.artist }));

      // Colour is a scannable "how sure was the matcher" signal down a long
      // pasted list -- green needs no attention, yellow is a single guess
      // worth a glance, orange is where a human decision actually matters
      // because more than one candidate is plausible, and red is "nothing
      // matched at all, this will create a brand-new song unless you pick
      // one." Green always wins over orange even when a confident match
      // also happens to have weaker candidates nearby -- those don't need
      // a second look just because they showed up in the list.
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
        // Nothing worth suggesting at all -- left as "+ Create new song"
        // with nothing pre-selected, which is a more consequential default
        // than a single unconfirmed guess (yellow), so it gets its own
        // colour rather than sharing yellow's.
        matchStatus = 'red';
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

      // Backfill an existing library song's missing artist from the pasted
      // line's artist, one song at a time -- only for rows that opted in
      // (see the "Also save … as this song's artist" checkbox in
      // ImportRow, which only appears when the matched song has no artist
      // of its own). .is('artist', null) repeats that guard server-side
      // rather than trusting the parse-time check alone, in case something
      // else set the song's artist in the meantime -- this never
      // overwrites a real value, it only ever fills a blank one.
      const backfillRows = parsed.filter(
        (item) => !item.skip && item.matchedSongId && item.backfillArtist !== false && item.artist?.trim()
      );
      for (const item of backfillRows) {
        const { error: backfillError } = await supabase
          .from('songs')
          .update({ artist: item.artist.trim() })
          .eq('id', item.matchedSongId)
          .is('artist', null);
        if (backfillError) throw backfillError;
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
// explanation colour alone can't carry.
const MATCH_LABELS = {
  green: 'Matched',
  yellow: 'Best guess — check it',
  orange: 'Multiple matches — check it',
  red: 'No match — new song',
};

const ImportRow = memo(function ImportRow({ index, item, allSongs, onUpdate }) {
  const otherSongs = useMemo(() => {
    const candidateIds = new Set(item.candidates.map((c) => c.id));
    return allSongs.filter((s) => !candidateIds.has(s.id));
  }, [item.candidates, allSongs]);

  const label = MATCH_LABELS[item.matchStatus];

  // Looked up fresh from allSongs (not item.candidates, which only ever
  // holds the matcher's own top 5) so this still works after a manual
  // re-pick from "All other songs" too -- re-evaluated live as
  // matchedSongId changes, not decided once at parse time, since which
  // song is actually selected can change after the fact.
  const matchedSong = item.matchedSongId ? allSongs.find((s) => s.id === item.matchedSongId) : null;
  // Only offered when the paste has an artist the library song doesn't --
  // never when the library song already has one of its own, so this can
  // only ever fill a blank, never look like it's overwriting something.
  const canBackfillArtist = Boolean(matchedSong && !item.skip && item.artist.trim() && !matchedSong.artist?.trim());

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
      {canBackfillArtist && (
        <label className="field__hint" style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '6px 0 0', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={item.backfillArtist !== false}
            onChange={(e) => onUpdate(index, { backfillArtist: e.target.checked })}
          />
          Also save "{item.artist}" as {matchedSong.title}'s artist in your library — it's currently blank
        </label>
      )}
    </div>
  );
});

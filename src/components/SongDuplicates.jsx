import { useDuplicateMerger } from '../hooks/useDuplicateMerger.js';
import CollapsibleSection from './CollapsibleSection.jsx';
import InfoTooltip from './InfoTooltip.jsx';

// How many of the "is this version worth keeping" signals a row has --
// used only to break a tie in gig_count when picking the default winner
// (the RPC itself just orders by gig_count, since that's the primary
// signal; completeness is the secondary one).
function completenessScore(row) {
  return (row.has_lyrics ? 1 : 0) + (row.has_video ? 1 : 0) + (row.artist ? 1 : 0) + (row.is_public ? 1 : 0);
}

function sortCompare(a, b) {
  return b.gig_count - a.gig_count || completenessScore(b) - completenessScore(a);
}

function buildConfirmMessage(winner, losers) {
  const loserList = losers.map((l) => `"${l.title}${l.artist ? ' — ' + l.artist : ''}"`).join(', ');
  return (
    `Merge ${loserList} into "${winner.title}${winner.artist ? ' — ' + winner.artist : ''}"? ` +
    'Every setlist, repertoire tick, backing track and song request on the other version' +
    (losers.length === 1 ? ' moves' : 's move') + ' over, and any of its details this version is missing get filled in. ' +
    'The other version' + (losers.length === 1 ? ' is' : 's are') + ' then deleted. This cannot be undone.'
  );
}

// Admin-only "possible duplicate songs" panel for SongsList.jsx. Finds
// songs that only differ by punctuation/case in their title (same
// normalization ImportSetlist.jsx already uses when matching a pasted
// setlist against the library -- the exact place duplicates like this
// tend to get created in the first place, one accidental "create new
// song" at a time) and suggests which version to keep: the one used on
// more real gigs, tie-broken by which has more of lyrics/video/artist/
// public filled in. Never merges without the admin picking a version and
// confirming -- the suggestion just saves them re-deriving it by hand.
export default function SongDuplicates({ onMerged }) {
  const { groups, sortedGroups, loading, mergingKey, winnerFor, selectWinner, handleMerge } = useDuplicateMerger({
    getGroupsRpc: 'get_song_duplicate_groups',
    mergeRpc: 'merge_duplicate_songs',
    groupKeyField: 'norm_title',
    sortCompare,
    buildConfirmMessage,
    noun: 'songs',
    onMerged,
  });

  if (groups === null) return null; // still loading on first mount, nothing to fold open to yet

  return (
    <CollapsibleSection
      title={<>Possible duplicates{sortedGroups.length > 0 ? ' (' + sortedGroups.length + ')' : ''}</>}
      titleExtra={
        <InfoTooltip text="Songs whose titles only differ by punctuation or case, most often created by importing the same setlist twice with slightly different wording. Suggests which version to keep -- the one used on more real gigs, tie-broken by which has more of its details filled in -- but never merges without you picking a version and confirming." />
      }
      defaultOpen={false}
    >
      {loading && <p className="field__hint">Checking…</p>}
      {!loading && sortedGroups.length === 0 && <p className="field__hint">No possible duplicates found.</p>}
      {sortedGroups.map((group) => {
        const key = group[0].norm_title;
        const winnerId = winnerFor(group);
        const busy = mergingKey === key;
        return (
          <div key={key} className="dup-merge-group">
            {group.map((row) => (
              <label key={row.id} className="dup-merge-option">
                <input
                  type="radio"
                  name={'dup-' + key}
                  checked={winnerId === row.id}
                  onChange={() => selectWinner(group, row.id)}
                  disabled={busy}
                />
                <span className="dup-merge-option__body">
                  <span className="dup-merge-option__title">
                    {row.title}{row.artist ? ' — ' + row.artist : ''}
                    {row.original_key && <span className="status-tag" style={{ marginLeft: 8, background: 'rgba(107,99,87,0.12)', color: 'var(--text-muted)', textTransform: 'none' }}>{row.original_key}</span>}
                  </span>
                  <span className="dup-merge-option__meta">
                    {row.gig_count} gig{row.gig_count === 1 ? '' : 's'}
                    {' · '}{row.has_lyrics ? '✓' : '✗'} lyrics
                    {' · '}{row.has_video ? '✓' : '✗'} video
                    {' · '}{row.artist ? '✓' : '✗'} artist
                  </span>
                </span>
              </label>
            ))}
            <div className="form-actions" style={{ justifyContent: 'flex-start', marginTop: 6 }}>
              <button type="button" className="btn btn--primary btn--small" onClick={() => handleMerge(group)} disabled={busy}>
                {busy ? 'Merging…' : `Merge the other ${group.length - 1} into the selected version`}
              </button>
            </div>
          </div>
        );
      })}
    </CollapsibleSection>
  );
}

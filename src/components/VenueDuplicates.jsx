import { useDuplicateMerger } from '../hooks/useDuplicateMerger.js';
import CollapsibleSection from './CollapsibleSection.jsx';
import InfoTooltip from './InfoTooltip.jsx';

// Same tie-break role as SongDuplicates.jsx's completenessScore.
function completenessScore(row) {
  return (row.has_contact ? 1 : 0) + (row.has_phone ? 1 : 0) + (row.has_notes ? 1 : 0) + (row.has_coords ? 1 : 0);
}

function sortCompare(a, b) {
  return b.gig_count - a.gig_count || completenessScore(b) - completenessScore(a);
}

function buildConfirmMessage(winner, losers) {
  const loserList = losers.map((l) => `"${l.name}"`).join(', ');
  return (
    `Merge ${loserList} into "${winner.name}"? ` +
    'Every gig booked at the other venue' + (losers.length === 1 ? ' moves' : 's move') + ' over, ' +
    'and any contact details or load-in notes this venue is missing get filled in. ' +
    'The other venue' + (losers.length === 1 ? ' is' : 's are') + ' then deleted. This cannot be undone.'
  );
}

// Admin-only "possible duplicate venues" panel for VenuesList.jsx. Unlike
// songs, a venue NAME alone isn't a safe duplicate signal -- plenty of real,
// genuinely different venues share a generic name ("The Red Lion", "Village
// Hall") in different towns -- so this only groups venues whose name AND
// address both match (see get_venue_duplicate_groups()), which is also why
// the address is shown on every row: it's the actual evidence these two
// rows are the same real place, not just a naming coincidence. Suggests
// which version to keep -- the one with more gigs booked at it, tie-broken
// by which has more of its contact/notes/coordinates filled in -- but never
// merges without the admin picking a version and confirming.
export default function VenueDuplicates({ onMerged }) {
  const { groups, sortedGroups, loading, mergingKey, winnerFor, selectWinner, handleMerge } = useDuplicateMerger({
    getGroupsRpc: 'get_venue_duplicate_groups',
    mergeRpc: 'merge_duplicate_venues',
    groupKeyField: 'norm_key',
    sortCompare,
    buildConfirmMessage,
    noun: 'venues',
    onMerged,
  });

  if (groups === null) return null;

  return (
    <CollapsibleSection
      title={<>Possible duplicates{sortedGroups.length > 0 ? ' (' + sortedGroups.length + ')' : ''}</>}
      titleExtra={
        <InfoTooltip text="Venues whose name AND address both match once punctuation/case differences are ignored -- a name match alone isn't checked, since plenty of real venues share a generic name in different towns. Suggests which version to keep -- the one with more gigs booked at it, tie-broken by which has more of its details filled in -- but never merges without you picking a version and confirming." />
      }
      defaultOpen={false}
    >
      {loading && <p className="field__hint">Checking…</p>}
      {!loading && sortedGroups.length === 0 && <p className="field__hint">No possible duplicates found.</p>}
      {sortedGroups.map((group) => {
        const key = group[0].norm_key;
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
                  <span className="dup-merge-option__title">{row.name}</span>
                  <span className="dup-merge-option__meta" style={{ fontFamily: 'inherit' }}>{row.address}</span>
                  <span className="dup-merge-option__meta">
                    {row.gig_count} gig{row.gig_count === 1 ? '' : 's'}
                    {' · '}{row.has_contact ? '✓' : '✗'} contact
                    {' · '}{row.has_phone ? '✓' : '✗'} phone
                    {' · '}{row.has_notes ? '✓' : '✗'} load-in notes
                    {' · '}{row.has_coords ? '✓' : '✗'} map location
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

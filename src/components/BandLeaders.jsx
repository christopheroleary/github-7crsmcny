import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { confirmAsync } from '../utils/confirmService.js';

export default function BandLeaders({ bandId }) {
  const [leaders, setLeaders] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [newLeaderId, setNewLeaderId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: leaderRows }, { data: bandLeaderProfiles }] = await Promise.all([
      supabase
        .from('band_leaders')
        .select('id, profile_id, profiles(full_name)')
        .eq('band_id', bandId),
      supabase.from('profiles').select('id, full_name').eq('role', 'band_leader').order('full_name'),
    ]);
    setLeaders(leaderRows || []);
    setCandidates(bandLeaderProfiles || []);
    setLoading(false);
  }, [bandId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAssign(e) {
    e.preventDefault();
    if (!newLeaderId) return;
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('band_leaders')
      .insert({ band_id: bandId, profile_id: newLeaderId, added_by: user?.id || null });
    if (error) { setError(error.message); return; }
    setNewLeaderId('');
    load();
  }

  async function handleRemove(leaderRow) {
    const name = leaderRow.profiles?.full_name || 'this leader';
    const ok = await confirmAsync('Remove ' + name + ' as a leader of this band?');
    if (!ok) return;
    const { error } = await supabase.from('band_leaders').delete().eq('id', leaderRow.id);
    if (error) { alert("Couldn't remove: " + error.message); return; }
    load();
  }

  if (loading) return <p className="state-message">Loading leaders…</p>;

  const assignedIds = new Set(leaders.map((l) => l.profile_id));
  const availableCandidates = candidates.filter((c) => !assignedIds.has(c.id));

  return (
    <div className="band-members">
      <ul className="simple-list">
        {leaders.length === 0 && <li className="state-message">No leaders assigned yet.</li>}
        {leaders.map((l) => (
          <li className="simple-list__item" key={l.id}>
            <div className="simple-list__row">
              <span className="simple-list__title">{l.profiles?.full_name || '—'}</span>
              <div className="simple-list__actions">
                <button className="link-button link-button--danger" onClick={() => handleRemove(l)}>
                  Remove
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <div className="inline-subform" style={{ marginTop: 12 }}>
        {availableCandidates.length === 0 ? (
          <p className="field__hint">
            No unassigned band leaders available. Promote a musician to "Band leader / owner" from the Musicians tab first.
          </p>
        ) : (
          <form onSubmit={handleAssign} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <select value={newLeaderId} onChange={(e) => setNewLeaderId(e.target.value)} required>
              <option value="">Choose band leader…</option>
              {availableCandidates.map((c) => (
                <option key={c.id} value={c.id}>{c.full_name}</option>
              ))}
            </select>
            {error && <p className="form-error">{error}</p>}
            <button type="submit" className="btn btn--primary btn--small">
              + Assign as leader
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

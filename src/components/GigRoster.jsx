import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useCurrentProfile } from '../context/ProfileContext.jsx';
import { confirmAsync } from '../utils/confirmService.js';
import { notify } from '../utils/toastService.js';
import DepFinderWizard from './DepFinderWizard.jsx';

const VOCAL_OPTIONS = [
  { value: '', label: 'Vocals — not set' },
  { value: 'none', label: 'No vocals' },
  { value: 'lead', label: 'Lead vocals' },
  { value: 'backing', label: 'Backing vocals' },
];

// The vocal_role dropdown ("Lead vocals" / "Backing vocals") is redundant once
// the chosen instrument already IS "Lead Vocals" or "Backing Vocals" — and
// meaningless for a DJ/roadie slot, since neither of those roles sings.
function isVocalInstrument(list, instrumentId) {
  return /vocal/i.test(list.find((i) => i.id === instrumentId)?.name || '');
}

function hidesVocalPrompt(list, instrumentId, isDj, isRoadie) {
  return isDj || isRoadie || isVocalInstrument(list, instrumentId);
}

const DJ_COLOUR = 'var(--amber-dark)';
const ROADIE_COLOUR = 'var(--teal)';

function RoleBadge({ label, colour }) {
  return (
    <span
      className="status-tag"
      style={{ marginLeft: 6, background: colour + '22', color: colour, border: '1px solid ' + colour + '44' }}
    >
      {label}
    </span>
  );
}

function RoleToggle({ label, active, colour, onClick, disabled }) {
  return (
    <button
      type="button"
      className={'role-toggle' + (active ? ' role-toggle--active' : '')}
      style={{ '--role-toggle-colour': colour }}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="role-toggle__dot" />
      {label}
    </button>
  );
}

function VocalBadge({ role }) {
  if (!role || role === 'none') return null;
  const label = role === 'lead' ? 'Lead vocals' : 'Backing vocals';
  const colour = role === 'lead' ? 'var(--amber)' : 'var(--teal)';
  return (
    <span
      className="status-tag"
      style={{ marginLeft: 6, background: colour + '22', color: colour, border: '1px solid ' + colour + '44' }}
    >
      {label}
    </span>
  );
}

function CaptainBadge() {
  return (
    <span
      className="status-tag"
      style={{ marginLeft: 6, background: 'var(--rust)22', color: 'var(--rust)', border: '1px solid var(--rust)44' }}
      title="Band captain (MD) for this gig"
    >
      ★ Captain
    </span>
  );
}

export default function GigRoster({ gigId }) {
  const { profile: me, isAdmin: isAdminRole, isBandLeader } = useCurrentProfile();
  const isAdmin = isAdminRole || isBandLeader;
  const [requirements, setRequirements] = useState([]);
  const [lineup, setLineup] = useState([]);
  const [musicians, setMusicians] = useState([]);
  const [placeholders, setPlaceholders] = useState([]);
  const [instruments, setInstruments] = useState([]);
  const [musicianInstruments, setMusicianInstruments] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Dep-finder wizard
  const [wizardInstrumentId, setWizardInstrumentId] = useState(null);

  // Real musician add
  const [newMusicianId, setNewMusicianId] = useState('');
  const [newInstrumentId, setNewInstrumentId] = useState('');
  const [newVocalRole, setNewVocalRole] = useState('');
  const [newIsDj, setNewIsDj] = useState(false);
  const [newIsRoadie, setNewIsRoadie] = useState(false);
  const [adding, setAdding] = useState(false);

  // Placeholder / dep add
  const [showPlaceholder, setShowPlaceholder] = useState(false);
  const [placeholderMode, setPlaceholderMode] = useState('existing');
  const [selectedPlaceholderId, setSelectedPlaceholderId] = useState('');
  const [placeholderInstrumentId, setPlaceholderInstrumentId] = useState('');
  const [placeholderVocalRole, setPlaceholderVocalRole] = useState('');
  const [placeholderIsDj, setPlaceholderIsDj] = useState(false);
  const [placeholderIsRoadie, setPlaceholderIsRoadie] = useState(false);
  const [newDepName, setNewDepName] = useState('');
  const [newDepInstrumentId, setNewDepInstrumentId] = useState('');
  const [newDepVocalRole, setNewDepVocalRole] = useState('');
  const [newDepIsDj, setNewDepIsDj] = useState(false);
  const [newDepIsRoadie, setNewDepIsRoadie] = useState(false);
  const [addingPlaceholder, setAddingPlaceholder] = useState(false);

  // Band preset
  const [applyingPreset, setApplyingPreset] = useState(false);
  const [gigBandId, setGigBandId] = useState(null);
  const [gigNeeds, setGigNeeds] = useState({ needs_dj: false, needs_roadie: false });

  useEffect(() => {
    supabase.from('gigs').select('band_id, needs_dj, needs_roadie').eq('id', gigId).single()
      .then(({ data }) => {
        setGigBandId(data?.band_id || null);
        setGigNeeds({ needs_dj: data?.needs_dj || false, needs_roadie: data?.needs_roadie || false });
      });
  }, [gigId]);

  async function handleApplyPreset() {
    if (!gigBandId) return;
    setApplyingPreset(true);
    setError(null);

    const { data: bandMembers } = await supabase
      .from('band_members')
      .select('profile_id, placeholder_id, instrument_id, profiles(full_name), placeholder_musicians(name), instruments(name)')
      .eq('band_id', gigBandId);

    let added = 0;
    for (const bm of (bandMembers || [])) {
      const alreadyIn = lineup.some((l) =>
        (bm.profile_id && l.profile_id === bm.profile_id) ||
        (bm.placeholder_id && l.placeholder_id === bm.placeholder_id)
      );
      if (alreadyIn) continue;

      await supabase.from('gig_lineup').insert({
        gig_id: gigId,
        profile_id: bm.profile_id || null,
        placeholder_id: bm.placeholder_id || null,
        instrument_id: bm.instrument_id || null,
        confirmed: false,
      });
      added++;
    }

    setApplyingPreset(false);
    if (added === 0) setError('All band preset members are already in the lineup.');
    load();
  }

  const load = useCallback(async () => {
    setLoading(true);
    const [
      { data: reqs },
      { data: lineupRows },
      { data: profiles },
      { data: insts },
      { data: links },
      { data: ph },
      { data: phInsts },
    ] = await Promise.all([
      supabase.from('gig_requirements').select('instrument_id, quantity, instruments(name)').eq('gig_id', gigId),
      supabase.from('gig_lineup').select('id, profile_id, placeholder_id, instrument_id, confirmed, vocal_role, is_captain, is_dj, is_roadie, role_on_gig, travel_cost_pence, fee_pence, confirmed_fee_pence, profiles(full_name), instruments(name), placeholder_musicians(name)').eq('gig_id', gigId),
      supabase.from('profiles').select('id, full_name').eq('is_active', true).order('full_name'),
      supabase.from('instruments').select('id, name').order('sort_order'),
      supabase.from('profile_instruments').select('profile_id, instrument_id, instruments(name)'),
      supabase.from('placeholder_musicians').select('id, name').is('merged_into', null).order('name'),
      supabase.from('placeholder_musician_instruments').select('placeholder_id, instrument_id, instruments(name)'),
    ]);

    setRequirements(reqs || []);
    setLineup(lineupRows || []);
    setMusicians(profiles || []);
    setInstruments(insts || []);

    const map = {};
    (links || []).forEach((l) => {
      if (!map[l.profile_id]) map[l.profile_id] = [];
      map[l.profile_id].push({ id: l.instrument_id, name: l.instruments?.name });
    });
    setMusicianInstruments(map);

    const phWithInsts = (ph || []).map((p) => ({
      ...p,
      knownInstruments: (phInsts || [])
        .filter((pi) => pi.placeholder_id === p.id)
        .map((pi) => ({ id: pi.instrument_id, name: pi.instruments?.name }))
        .filter((i) => i.name),
    }));
    setPlaceholders(phWithInsts);
    setLoading(false);
  }, [gigId]);

  useEffect(() => { load(); }, [load]);

  // Warns (doesn't block) when adding another musician on an instrument that's
  // already filled to its requested quantity — e.g. a 2nd bass player when
  // only 1 was asked for.
  async function confirmIfOverfilled(instrumentId) {
    const req = requirements.find((r) => r.instrument_id === instrumentId);
    if (!req) return true;
    const currentCount = lineup.filter((l) => l.instrument_id === instrumentId).length;
    if (currentCount < req.quantity) return true;
    const instName = req.instruments?.name || 'this instrument';
    return confirmAsync(
      instName + ' already has ' + currentCount + ' of ' + req.quantity + ' requested filled. Add another anyway?'
    );
  }

  // ── Add registered musician ──────────────────────────────────────────────
  async function handleAdd(e) {
    e.preventDefault();
    if (!newMusicianId || (!newInstrumentId && !newIsDj && !newIsRoadie)) return;
    setAdding(true);
    setError(null);

    if (lineup.some((l) => l.profile_id === newMusicianId)) {
      setError('This musician is already on the roster.');
      setAdding(false);
      return;
    }

    if (newInstrumentId && !(await confirmIfOverfilled(newInstrumentId))) {
      setAdding(false);
      return;
    }

    const { error } = await supabase.from('gig_lineup').insert({
      gig_id: gigId,
      profile_id: newMusicianId,
      placeholder_id: null,
      instrument_id: newInstrumentId || null,
      confirmed: false,
      vocal_role: hidesVocalPrompt(availableForMusician, newInstrumentId, newIsDj, newIsRoadie) ? null : (newVocalRole || null),
      is_dj: newIsDj,
      is_roadie: newIsRoadie,
    });
    setAdding(false);
    if (error) { setError(error.message); return; }
    setNewMusicianId('');
    setNewInstrumentId('');
    setNewVocalRole('');
    setNewIsDj(false);
    setNewIsRoadie(false);
    load();
  }

  // ── Add existing dep ─────────────────────────────────────────────────────
  async function handleAddExistingDep(e) {
    e.preventDefault();
    if (!selectedPlaceholderId || (!placeholderInstrumentId && !placeholderIsDj && !placeholderIsRoadie)) return;
    setAddingPlaceholder(true);
    setError(null);

    if (lineup.some((l) => l.placeholder_id === selectedPlaceholderId)) {
      setError('This dep is already on the roster.');
      setAddingPlaceholder(false);
      return;
    }

    if (placeholderInstrumentId && !(await confirmIfOverfilled(placeholderInstrumentId))) {
      setAddingPlaceholder(false);
      return;
    }

    if (placeholderInstrumentId) {
      await supabase.from('placeholder_musician_instruments')
        .upsert(
          { placeholder_id: selectedPlaceholderId, instrument_id: placeholderInstrumentId },
          { onConflict: 'placeholder_id,instrument_id', ignoreDuplicates: true }
        );
    }

    const { error } = await supabase.from('gig_lineup').insert({
      gig_id: gigId,
      profile_id: null,
      placeholder_id: selectedPlaceholderId,
      instrument_id: placeholderInstrumentId || null,
      confirmed: false,
      vocal_role: hidesVocalPrompt(availableForDep, placeholderInstrumentId, placeholderIsDj, placeholderIsRoadie) ? null : (placeholderVocalRole || null),
      is_dj: placeholderIsDj,
      is_roadie: placeholderIsRoadie,
    });
    setAddingPlaceholder(false);
    if (error) { setError(error.message); return; }
    setSelectedPlaceholderId('');
    setPlaceholderInstrumentId('');
    setPlaceholderVocalRole('');
    setPlaceholderIsDj(false);
    setPlaceholderIsRoadie(false);
    setShowPlaceholder(false);
    load();
  }

  // ── Add brand new dep ────────────────────────────────────────────────────
  async function handleAddNewDep(e) {
    e.preventDefault();
    if (!newDepName.trim() || (!newDepInstrumentId && !newDepIsDj && !newDepIsRoadie)) return;
    setAddingPlaceholder(true);
    setError(null);

    const existingPh = placeholders.find(
      (p) => p.name.trim().toLowerCase() === newDepName.trim().toLowerCase()
    );

    let phId;
    if (existingPh) {
      phId = existingPh.id;
    } else {
      const { data: newPh, error: phErr } = await supabase
        .from('placeholder_musicians')
        .insert({ name: newDepName.trim(), created_by: me?.id })
        .select()
        .single();
      if (phErr) { setError(phErr.message); setAddingPlaceholder(false); return; }
      phId = newPh.id;
    }

    if (lineup.some((l) => l.placeholder_id === phId)) {
      setError((existingPh ? existingPh.name : newDepName) + ' is already on the roster.');
      setAddingPlaceholder(false);
      return;
    }

    if (newDepInstrumentId && !(await confirmIfOverfilled(newDepInstrumentId))) {
      setAddingPlaceholder(false);
      return;
    }

    if (newDepInstrumentId) {
      await supabase.from('placeholder_musician_instruments')
        .upsert(
          { placeholder_id: phId, instrument_id: newDepInstrumentId },
          { onConflict: 'placeholder_id,instrument_id', ignoreDuplicates: true }
        );
    }

    const { error } = await supabase.from('gig_lineup').insert({
      gig_id: gigId,
      profile_id: null,
      placeholder_id: phId,
      instrument_id: newDepInstrumentId || null,
      confirmed: false,
      vocal_role: hidesVocalPrompt(instruments, newDepInstrumentId, newDepIsDj, newDepIsRoadie) ? null : (newDepVocalRole || null),
      is_dj: newDepIsDj,
      is_roadie: newDepIsRoadie,
    });
    setAddingPlaceholder(false);
    if (error) { setError(error.message); return; }
    setNewDepName('');
    setNewDepInstrumentId('');
    setNewDepVocalRole('');
    setNewDepIsDj(false);
    setNewDepIsRoadie(false);
    setShowPlaceholder(false);
    load();
  }

  async function handleRemove(entry) {
    const name = entry.profiles?.full_name || entry.placeholder_musicians?.name || 'this musician';
    let confirmMessage = 'Remove ' + name + " from this gig's lineup?";

    // Guard rail: warn if this musician has an approved/paid claim for this gig,
    // since removing them from the roster doesn't touch that claim.
    if (entry.profile_id) {
      const { data: claims } = await supabase
        .from('musician_claims')
        .select('status, musician_claim_items(amount_pence)')
        .eq('gig_id', gigId)
        .eq('profile_id', entry.profile_id)
        .in('status', ['approved', 'paid']);

      if (claims?.length) {
        const claim = claims[0];
        const totalPence = (claim.musician_claim_items || []).reduce((sum, i) => sum + i.amount_pence, 0);
        confirmMessage =
          name + ' has a ' + claim.status + ' claim of £' + (totalPence / 100).toFixed(2) +
          " for this gig. Removing them from the roster will NOT change that claim — you'll need to " +
          'handle it separately. Remove anyway?';
      }
    }

    const ok = await confirmAsync(confirmMessage);
    if (!ok) return;
    const { error } = await supabase.from('gig_lineup').delete().eq('id', entry.id);
    if (error) { notify("Couldn't remove: " + error.message); return; }
    load();
  }

  async function handleConfirm(entry) {
    const { error } = await supabase.from('gig_lineup').update({ confirmed: true }).eq('id', entry.id);
    if (error) { notify("Couldn't confirm: " + error.message); return; }
    load();
  }

  async function handleUpdateVocalRole(entryId, vocal_role) {
    const { error } = await supabase.from('gig_lineup').update({ vocal_role: vocal_role || null }).eq('id', entryId);
    if (error) { notify("Couldn't update vocal role: " + error.message); return; }
    load();
  }

  // Toggling DJ/roadie on for an existing roster row — clears vocal_role since
  // neither role sings. Freely combinable with a real instrument and with
  // each other (unlike instruments, which stay single-select per person).
  async function handleToggleDj(entry) {
    const makingDj = !entry.is_dj;
    const { error } = await supabase.from('gig_lineup')
      .update({ is_dj: makingDj, vocal_role: makingDj ? null : entry.vocal_role })
      .eq('id', entry.id);
    if (error) { notify("Couldn't update DJ role: " + error.message); return; }
    load();
  }

  async function handleToggleRoadie(entry) {
    const makingRoadie = !entry.is_roadie;
    const { error } = await supabase.from('gig_lineup')
      .update({ is_roadie: makingRoadie, vocal_role: makingRoadie ? null : entry.vocal_role })
      .eq('id', entry.id);
    if (error) { notify("Couldn't update roadie role: " + error.message); return; }
    load();
  }

  // Only one captain per gig — setting a new one clears any previous one.
  async function handleToggleCaptain(entry) {
    const makingCaptain = !entry.is_captain;
    if (makingCaptain) {
      await supabase.from('gig_lineup').update({ is_captain: false }).eq('gig_id', gigId).eq('is_captain', true);
    }
    const { error } = await supabase.from('gig_lineup').update({ is_captain: makingCaptain }).eq('id', entry.id);
    if (error) { notify("Couldn't update captain: " + error.message); return; }
    load();
  }

  if (loading) return <p className="state-message">Loading roster…</p>;

  const filledCounts = {};
  lineup.forEach((l) => {
    if (l.instrument_id) filledCounts[l.instrument_id] = (filledCounts[l.instrument_id] || 0) + 1;
  });

  const pickedMusicianInstruments = newMusicianId ? musicianInstruments[newMusicianId] || [] : [];
  const availableForMusician = pickedMusicianInstruments.length > 0 ? pickedMusicianInstruments : instruments;

  const selectedDepData = selectedPlaceholderId ? placeholders.find((p) => p.id === selectedPlaceholderId) : null;
  const availableForDep = selectedDepData?.knownInstruments?.length > 0
    ? selectedDepData.knownInstruments
    : instruments;

  const rosteredProfileIds = lineup.filter((l) => l.profile_id).map((l) => l.profile_id);
  const rosteredPlaceholderIds = lineup.filter((l) => l.placeholder_id).map((l) => l.placeholder_id);

  // Captain always leads the list; a pure DJ/roadie (no instrument, so not
  // actually performing) sinks to the bottom. Everyone else keeps roster order.
  function rosterSortKey(entry) {
    if (entry.is_captain) return 0;
    if (!entry.instrument_id && (entry.is_dj || entry.is_roadie)) return 2;
    return 1;
  }
  const sortedLineup = [...lineup].sort((a, b) => rosterSortKey(a) - rosterSortKey(b));

  return (
    <div className="roster-section">
      <h3 className="roster-section__title">Roster &amp; vacancies</h3>

      {isAdmin && (
        <button
          type="button"
          className="btn btn--ghost btn--small"
          style={{ marginBottom: 12 }}
          onClick={() => setWizardInstrumentId(instruments[0]?.id || '')}
        >
          🔍 Find a dep
        </button>
      )}

      {(requirements.length > 0 || gigNeeds.needs_dj || gigNeeds.needs_roadie) && (
        <ul className="vacancy-list">
          {requirements.map((r, i) => {
            const filled = filledCounts[r.instrument_id] || 0;
            const vacant = Math.max(0, r.quantity - filled);
            return (
              <li key={i} className={vacant > 0 ? 'vacancy-list__item vacancy-list__item--open' : 'vacancy-list__item'}>
                <span>{r.instruments?.name}</span>
                <span>
                  {filled}/{r.quantity} filled{vacant > 0 ? ' — need ' + vacant + ' more' : ''}
                  {isAdmin && vacant > 0 && (
                    <button
                      type="button"
                      className="link-button"
                      style={{ marginLeft: 8 }}
                      onClick={() => setWizardInstrumentId(r.instrument_id)}
                    >
                      Find a dep
                    </button>
                  )}
                </span>
              </li>
            );
          })}
          {gigNeeds.needs_dj && (() => {
            const filled = lineup.filter((l) => l.is_dj).length;
            return (
              <li className={filled === 0 ? 'vacancy-list__item vacancy-list__item--open' : 'vacancy-list__item'}>
                <span>DJ</span>
                <span>{filled}/1 filled{filled === 0 ? ' — need 1 more' : ''}</span>
              </li>
            );
          })()}
          {gigNeeds.needs_roadie && (() => {
            const filled = lineup.filter((l) => l.is_roadie).length;
            return (
              <li className={filled === 0 ? 'vacancy-list__item vacancy-list__item--open' : 'vacancy-list__item'}>
                <span>Roadie</span>
                <span>{filled}/1 filled{filled === 0 ? ' — need 1 more' : ''}</span>
              </li>
            );
          })()}
        </ul>
      )}

      <ul className="simple-list">
        {lineup.length === 0 && <li className="state-message">Nobody booked yet.</li>}
        {sortedLineup.map((entry) => {
          const isPlaceholder = !entry.profile_id;
          const isMe = entry.profile_id === me?.id;
          const displayName = entry.profiles?.full_name || entry.placeholder_musicians?.name || 'Unknown';
          return (
            <li className="simple-list__item" key={entry.id}>
              <div className="simple-list__row">
                <div>
                  <span className="simple-list__title">
                    {displayName}
                    {isPlaceholder && (
                      <span className="status-tag" style={{ marginLeft: 8, background: 'rgba(107,99,87,0.12)', color: 'var(--text-muted)' }}>
                        dep
                      </span>
                    )}
                    <VocalBadge role={entry.vocal_role} />
                    {entry.is_captain && <CaptainBadge />}
                    {entry.is_dj && <RoleBadge label="DJ" colour={DJ_COLOUR} />}
                    {entry.is_roadie && <RoleBadge label="Roadie" colour={ROADIE_COLOUR} />}
                  </span>
                  <span className="simple-list__subtitle">
                    {[entry.instruments?.name, entry.is_dj && 'DJ', entry.is_roadie && 'Roadie'].filter(Boolean).join(' + ') || '—'}
                  </span>
                  {isAdmin && !hidesVocalPrompt(instruments, entry.instrument_id, entry.is_dj, entry.is_roadie) && (
                    <select
                      value={entry.vocal_role || ''}
                      onChange={(e) => handleUpdateVocalRole(entry.id, e.target.value)}
                      style={{ fontSize: 12, marginTop: 6, padding: '3px 6px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--paper)', color: 'var(--ink)', display: 'block' }}
                    >
                      {VOCAL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  )}
                  {isAdmin && (
                    <div className="role-toggle-group" style={{ marginTop: 6 }}>
                      <RoleToggle
                        label="DJ"
                        active={entry.is_dj}
                        colour={DJ_COLOUR}
                        onClick={() => handleToggleDj(entry)}
                      />
                      <RoleToggle
                        label="Roadie"
                        active={entry.is_roadie}
                        colour={ROADIE_COLOUR}
                        onClick={() => handleToggleRoadie(entry)}
                      />
                      <RoleToggle
                        label="Captain"
                        active={entry.is_captain}
                        colour="var(--rust)"
                        onClick={() => handleToggleCaptain(entry)}
                      />
                    </div>
                  )}
                </div>
                <div className="simple-list__actions">
                  <span className={entry.confirmed ? 'status-tag status-tag--confirmed' : 'status-tag status-tag--inquiry'}>
                    {entry.confirmed ? 'Confirmed' : 'Pending'}
                  </span>
                  {entry.confirmed && entry.confirmed_fee_pence != null && entry.fee_pence < entry.confirmed_fee_pence && (
                    <span className="status-tag status-tag--cancelled" title={'Confirmed at £' + (entry.confirmed_fee_pence / 100).toFixed(2)}>
                      ⚠ Fee cut £{((entry.confirmed_fee_pence - entry.fee_pence) / 100).toFixed(2)}
                    </span>
                  )}
                  {!entry.confirmed && (isMe || isAdmin) && (
                    <button className="link-button" onClick={() => handleConfirm(entry)}>Confirm</button>
                  )}
                  {isAdmin && (
                    <button className="link-button link-button--danger" onClick={() => handleRemove(entry)}>Remove</button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {isAdmin && (
        <div style={{ marginTop: 16 }}>
          {error && <p className="form-error" style={{ marginBottom: 8 }}>{error}</p>}

          {gigBandId && (
            <div style={{ marginBottom: 12 }}>
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={handleApplyPreset}
                disabled={applyingPreset}
              >
                {applyingPreset ? 'Applying…' : '⚡ Apply band preset'}
              </button>
              <span className="field__hint" style={{ marginLeft: 8 }}>Adds all standard band members in one click</span>
            </div>
          )}

          {/* Add registered musician */}
          <form className="inline-subform" onSubmit={handleAdd} style={{ marginBottom: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Add registered musician
            </span>
            <select
              value={newMusicianId}
              onChange={(e) => {
                const id = e.target.value;
                setNewMusicianId(id);
                // Pre-select their instrument when they only play one.
                const theirInstruments = musicianInstruments[id] || [];
                setNewInstrumentId(theirInstruments.length === 1 ? theirInstruments[0].id : '');
                setNewVocalRole('');
                setNewIsDj(false);
                setNewIsRoadie(false);
              }}
              required
            >
              <option value="">Choose musician…</option>
              {musicians
                .filter((m) => !rosteredProfileIds.includes(m.id))
                .map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
            </select>
            <select
              value={newInstrumentId}
              onChange={(e) => { setNewInstrumentId(e.target.value); setNewVocalRole(''); }}
              disabled={!newMusicianId}
            >
              <option value="">{newMusicianId ? 'No instrument (DJ / roadie only)' : 'Pick a musician first'}</option>
              {availableForMusician.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
            {newMusicianId && pickedMusicianInstruments.length === 0 && (
              <p className="field__hint">No instruments on profile — showing all.</p>
            )}
            {!hidesVocalPrompt(availableForMusician, newInstrumentId, newIsDj, newIsRoadie) && (
              <select
                value={newVocalRole}
                onChange={(e) => setNewVocalRole(e.target.value)}
                disabled={!newMusicianId}
              >
                {VOCAL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )}
            <div className="role-toggle-group">
              <RoleToggle label="DJ" active={newIsDj} colour={DJ_COLOUR} disabled={!newMusicianId} onClick={() => setNewIsDj((v) => !v)} />
              <RoleToggle label="Roadie" active={newIsRoadie} colour={ROADIE_COLOUR} disabled={!newMusicianId} onClick={() => setNewIsRoadie((v) => !v)} />
            </div>
            <button type="submit" className="btn btn--primary btn--small" disabled={adding || !newMusicianId || (!newInstrumentId && !newIsDj && !newIsRoadie)}>
              {adding ? 'Adding…' : '+ Add to roster'}
            </button>
          </form>

          {/* Add dep */}
          {!showPlaceholder ? (
            <button className="link-button" onClick={() => { setShowPlaceholder(true); setPlaceholderMode('existing'); }}>
              + Add dep / session musician
            </button>
          ) : (
            <div className="inline-subform">
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Add dep / session musician
              </span>

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className={placeholderMode === 'existing' ? 'btn btn--primary btn--small' : 'btn btn--ghost btn--small'}
                  onClick={() => { setPlaceholderMode('existing'); setSelectedPlaceholderId(''); setPlaceholderInstrumentId(''); setPlaceholderVocalRole(''); setPlaceholderIsDj(false); setPlaceholderIsRoadie(false); }}
                >
                  Existing dep
                </button>
                <button
                  type="button"
                  className={placeholderMode === 'new' ? 'btn btn--primary btn--small' : 'btn btn--ghost btn--small'}
                  onClick={() => { setPlaceholderMode('new'); setNewDepName(''); setNewDepInstrumentId(''); setNewDepVocalRole(''); setNewDepIsDj(false); setNewDepIsRoadie(false); }}
                >
                  New dep
                </button>
              </div>

              {placeholderMode === 'existing' ? (
                <form onSubmit={handleAddExistingDep} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {placeholders.filter((p) => !rosteredPlaceholderIds.includes(p.id)).length === 0 ? (
                    <p className="field__hint">All known deps are already on this roster. Use "New dep" to add someone new.</p>
                  ) : (
                    <>
                      <select
                        value={selectedPlaceholderId}
                        onChange={(e) => {
                          setSelectedPlaceholderId(e.target.value);
                          setPlaceholderInstrumentId('');
                          setPlaceholderVocalRole('');
                          setPlaceholderIsDj(false);
                          setPlaceholderIsRoadie(false);
                        }}
                        required
                      >
                        <option value="">Choose dep…</option>
                        {placeholders
                          .filter((p) => !rosteredPlaceholderIds.includes(p.id))
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}{p.knownInstruments?.length ? ' (' + p.knownInstruments.map((i) => i.name).join(', ') + ')' : ''}
                            </option>
                          ))}
                      </select>

                      {selectedPlaceholderId && (
                        <>
                          <select
                            value={placeholderInstrumentId}
                            onChange={(e) => { setPlaceholderInstrumentId(e.target.value); setPlaceholderVocalRole(''); }}
                          >
                            <option value="">No instrument (DJ / roadie only)</option>
                            {availableForDep.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                          </select>
                          {selectedDepData?.knownInstruments?.length === 0 && (
                            <p className="field__hint">No instruments saved for this dep yet — your selection will be saved to their profile.</p>
                          )}
                          {!hidesVocalPrompt(availableForDep, placeholderInstrumentId, placeholderIsDj, placeholderIsRoadie) && (
                            <select
                              value={placeholderVocalRole}
                              onChange={(e) => setPlaceholderVocalRole(e.target.value)}
                            >
                              {VOCAL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                          )}
                          <div className="role-toggle-group">
                            <RoleToggle label="DJ" active={placeholderIsDj} colour={DJ_COLOUR} onClick={() => setPlaceholderIsDj((v) => !v)} />
                            <RoleToggle label="Roadie" active={placeholderIsRoadie} colour={ROADIE_COLOUR} onClick={() => setPlaceholderIsRoadie((v) => !v)} />
                          </div>
                        </>
                      )}

                      <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
                        <button type="button" className="btn btn--ghost btn--small" onClick={() => setShowPlaceholder(false)}>Cancel</button>
                        <button
                          type="submit"
                          className="btn btn--primary btn--small"
                          disabled={addingPlaceholder || !selectedPlaceholderId || (!placeholderInstrumentId && !placeholderIsDj && !placeholderIsRoadie)}
                        >
                          {addingPlaceholder ? 'Adding…' : '+ Add dep'}
                        </button>
                      </div>
                    </>
                  )}
                </form>
              ) : (
                <form onSubmit={handleAddNewDep} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <input
                    placeholder="Full name (e.g. Dave Smith)"
                    value={newDepName}
                    onChange={(e) => setNewDepName(e.target.value)}
                    required
                  />
                  <select
                    value={newDepInstrumentId}
                    onChange={(e) => { setNewDepInstrumentId(e.target.value); setNewDepVocalRole(''); }}
                  >
                    <option value="">No instrument (DJ / roadie only)</option>
                    {instruments.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </select>
                  {!hidesVocalPrompt(instruments, newDepInstrumentId, newDepIsDj, newDepIsRoadie) && (
                    <select
                      value={newDepVocalRole}
                      onChange={(e) => setNewDepVocalRole(e.target.value)}
                    >
                      {VOCAL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  )}
                  <div className="role-toggle-group">
                    <RoleToggle label="DJ" active={newDepIsDj} colour={DJ_COLOUR} onClick={() => setNewDepIsDj((v) => !v)} />
                    <RoleToggle label="Roadie" active={newDepIsRoadie} colour={ROADIE_COLOUR} onClick={() => setNewDepIsRoadie((v) => !v)} />
                  </div>
                  <p className="field__hint">Their instrument (if any) will be saved so you can reuse them on future gigs.</p>
                  <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
                    <button type="button" className="btn btn--ghost btn--small" onClick={() => setShowPlaceholder(false)}>Cancel</button>
                    <button
                      type="submit"
                      className="btn btn--primary btn--small"
                      disabled={addingPlaceholder || !newDepName.trim() || (!newDepInstrumentId && !newDepIsDj && !newDepIsRoadie)}
                    >
                      {addingPlaceholder ? 'Adding…' : '+ Add new dep'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
      )}

      {wizardInstrumentId != null && (
        <DepFinderWizard
          gigId={gigId}
          instruments={instruments}
          initialInstrumentId={wizardInstrumentId}
          onClose={() => setWizardInstrumentId(null)}
          onAdded={load}
        />
      )}
    </div>
  );
}

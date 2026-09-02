import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';
import MusicianEditForm from './MusicianEditForm.jsx';
import MyExpenses from './MyExpenses.jsx';
import MyIncome from './MyIncome.jsx';
import MyMileage from './MyMileage.jsx';
import MyRepertoire from './MyRepertoire.jsx';
import PlaceholderRepertoire from './PlaceholderRepertoire.jsx';
import OutstandingClaims from './OutstandingClaims.jsx';
import TaxRecords from './TaxRecords.jsx';
import { useCurrentProfile } from '../context/ProfileContext.jsx';
import SearchBox from './SearchBox.jsx';
import { useFuzzySearch } from '../hooks/useFuzzySearch.js';
import AddressAutocomplete from './AddressAutocomplete.jsx';
import { confirmAsync } from '../utils/confirmService.js';
import { notify } from '../utils/toastService.js';
import EquipmentFields from './EquipmentFields.jsx';
import EquipmentTags from './EquipmentTags.jsx';
import { EQUIPMENT_ITEMS } from '../utils/equipment.js';
import { buildInviteMailto } from '../utils/depInvite.js';

export default function MusiciansList() {
  const { profile: me, isAdmin, isBandLeader, ledBandIds } = useCurrentProfile();
  const [musicians, setMusicians] = useState([]);
  const [allInstruments, setAllInstruments] = useState([]);
  const [gigCountsByProfile, setGigCountsByProfile] = useState({});
  const [gigCountsByPlaceholder, setGigCountsByPlaceholder] = useState({});
  const [filterInstrumentId, setFilterInstrumentId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [expandedExpensesId, setExpandedExpensesId] = useState(null);
  const [expandedIncomeId, setExpandedIncomeId] = useState(null);
  const [expandedMileageId, setExpandedMileageId] = useState(null);
  const [expandedRepertoireId, setExpandedRepertoireId] = useState(null);
  const [expandedOutstandingId, setExpandedOutstandingId] = useState(null);
  const [expandedTaxId, setExpandedTaxId] = useState(null);
  const [editingId, setEditingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [
      { data: profiles, error: profilesError },
      { data: links },
      { data: insts },
      { data: lineupRows },
    ] = await Promise.all([
      supabase.from('profiles').select('id, full_name, role, is_active, subscription_tier, home_address, home_latitude, home_longitude, has_pa, has_subs, has_iem, has_mics, has_cables, has_lighting, equipment_notes').order('full_name'),
      supabase.from('profile_instruments').select('profile_id, instrument_id, instruments(id, name)'),
      supabase.from('instruments').select('id, name').order('sort_order'),
      // Confirmed/completed only -- an inquiry gig isn't a real booking yet,
      // so it shouldn't count toward "this dep has actually played for us".
      supabase
        .from('gig_lineup')
        .select('profile_id, placeholder_id, gig_id, gigs!inner(status, band_id)')
        .in('gigs.status', ['confirmed', 'completed']),
    ]);

    if (profilesError) {
      setError(profilesError.message);
      setLoading(false);
      return;
    }

    // phone isn't in the blanket column grant (see
    // 20260826150000_restrict_profile_phone.sql) -- admin/band-leader
    // access to this whole list already satisfies the RPC's own check, so
    // this always returns every row it just asked the main query for.
    const { data: phoneRows } = await supabase.rpc('get_profile_phones', {
      p_profile_ids: (profiles || []).map((p) => p.id),
    });
    const phoneById = Object.fromEntries((phoneRows || []).map((r) => [r.id, r.phone]));

    const withInstruments = (profiles || []).map((p) => ({
      ...p,
      phone: phoneById[p.id] || null,
      instruments: (links || [])
        .filter((l) => l.profile_id === p.id)
        .map((l) => ({ id: l.instrument_id, name: l.instruments?.name }))
        .filter((i) => i.name),
    }));

    // Scoped to "the bands this viewer is in charge of" -- admin sees every
    // band's gigs, a band leader only sees gigs for the band(s) they lead,
    // so a musician who's only ever played for a band this leader doesn't
    // run still correctly shows up as "not yet booked" from their POV.
    const inScope = (row) => isAdmin || ledBandIds.includes(row.gigs?.band_id);
    const profileGigIds = {};
    const placeholderGigIds = {};
    for (const row of lineupRows || []) {
      if (!inScope(row)) continue;
      if (row.profile_id) {
        (profileGigIds[row.profile_id] ??= new Set()).add(row.gig_id);
      }
      if (row.placeholder_id) {
        (placeholderGigIds[row.placeholder_id] ??= new Set()).add(row.gig_id);
      }
    }
    setGigCountsByProfile(
      Object.fromEntries(Object.entries(profileGigIds).map(([id, set]) => [id, set.size]))
    );
    setGigCountsByPlaceholder(
      Object.fromEntries(Object.entries(placeholderGigIds).map(([id, set]) => [id, set.size]))
    );

    setMusicians(withInstruments);
    setAllInstruments(insts || []);
    setLoading(false);
  }, [isAdmin, ledBandIds]);

  useEffect(() => { load(); }, [load]);

  function handleSaved() {
    setEditingId(null);
    load();
  }

  async function handleToggleActive(musician) {
    const action = musician.is_active ? 'Deactivate' : 'Reactivate';
    const consequence = musician.is_active
      ? "They'll be hidden from active rosters but their history is kept."
      : "They'll reappear in roster selections.";
    const ok = await confirmAsync(action + ' ' + musician.full_name + '? ' + consequence);
    if (!ok) return;
    const { error } = await supabase.from('profiles').update({ is_active: !musician.is_active }).eq('id', musician.id);
    if (error) { notify("Couldn't update: " + error.message); return; }
    load();
  }

  // Filter musicians by instrument
  const byInstrument = filterInstrumentId
    ? musicians.filter((m) => m.instruments.some((i) => i.id === filterInstrumentId))
    : musicians;

  const { query, setQuery, results: filtered } = useFuzzySearch(byInstrument, [
    'full_name',
    'instruments.name',
  ]);

  // Split rather than just sort, per band leaders' actual complaint: someone
  // never booked for a band this viewer runs shouldn't sit inline among the
  // regulars, even alphabetically -- they need their own clearly-separate
  // "not yet booked" group at the bottom.
  const bookedMusicians = filtered.filter((m) => (gigCountsByProfile[m.id] || 0) > 0);
  const unbookedMusicians = filtered.filter((m) => (gigCountsByProfile[m.id] || 0) === 0);

  function renderMusicianItem(m) {
    const gigCount = gigCountsByProfile[m.id] || 0;
    return (
      <li className="simple-list__item" key={m.id}>
        {editingId === m.id ? (
          <MusicianEditForm profile={m} onSaved={handleSaved} onCancel={() => setEditingId(null)} />
        ) : (
          <>
            <div className="musician-card__title">
              <span className="simple-list__title">{m.full_name}</span>
              {m.role === 'admin' && <span className="status-tag status-tag--cancelled">admin</span>}
              {m.role === 'band_leader' && <span className="status-tag status-tag--confirmed">band leader</span>}
              {m.subscription_tier === 'pro' && <span className="status-tag status-tag--inquiry">pro</span>}
              {!m.is_active && <span className="status-tag">inactive</span>}
              {m.id === me?.id && <span className="status-tag">you</span>}
              <span className="musician-card__meta">{gigCount} gig{gigCount === 1 ? '' : 's'}</span>
            </div>
            <span className="simple-list__subtitle">
              {m.instruments.length > 0
                ? m.instruments.map((i) => i.name).join(', ')
                : 'No instruments set'}
            </span>
            <EquipmentTags values={m} />
            <div className="musician-card__actions">
              <button className="link-button" onClick={() => setExpandedId(expandedId === m.id ? null : m.id)}>
                {expandedId === m.id ? 'Hide' : 'View'}
              </button>
              {isAdmin && (
                <button
                  className="link-button"
                  onClick={() => setExpandedOutstandingId(expandedOutstandingId === m.id ? null : m.id)}
                >
                  {expandedOutstandingId === m.id ? 'Hide outstanding' : 'Outstanding'}
                </button>
              )}
              {isAdmin && (
                <button
                  className="link-button"
                  onClick={() => setExpandedExpensesId(expandedExpensesId === m.id ? null : m.id)}
                >
                  {expandedExpensesId === m.id ? 'Hide other expenses' : 'Other expenses'}
                </button>
              )}
              {isAdmin && (
                <button
                  className="link-button"
                  onClick={() => setExpandedIncomeId(expandedIncomeId === m.id ? null : m.id)}
                >
                  {expandedIncomeId === m.id ? 'Hide other income' : 'Other income'}
                </button>
              )}
              {isAdmin && (
                <button
                  className="link-button"
                  onClick={() => setExpandedMileageId(expandedMileageId === m.id ? null : m.id)}
                >
                  {expandedMileageId === m.id ? 'Hide other mileage' : 'Other mileage'}
                </button>
              )}
              {isAdmin && (
                <button
                  className="link-button"
                  onClick={() => setExpandedRepertoireId(expandedRepertoireId === m.id ? null : m.id)}
                >
                  {expandedRepertoireId === m.id ? 'Hide repertoire' : 'Repertoire'}
                </button>
              )}
              {isAdmin && (
                <button
                  className="link-button"
                  onClick={() => setExpandedTaxId(expandedTaxId === m.id ? null : m.id)}
                >
                  {expandedTaxId === m.id ? 'Hide tax records' : 'Tax records'}
                </button>
              )}
              {isAdmin && m.id !== me?.id && (
                <>
                  <button className="link-button" onClick={() => setEditingId(m.id)}>Edit</button>
                  <button
                    className="link-button link-button--danger"
                    onClick={() => handleToggleActive(m)}
                  >
                    {m.is_active ? 'Deactivate' : 'Reactivate'}
                  </button>
                </>
              )}
            </div>
            {expandedId === m.id && (
              <dl className="detail-list" style={{ marginTop: 10 }}>
                <dt>Phone</dt><dd>{m.phone || '—'}</dd>
                <dt>Role</dt><dd>{m.role}</dd>
                <dt>Home address</dt><dd>{m.home_address || '—'}</dd>
                <dt>Instruments</dt><dd>{m.instruments.length > 0 ? m.instruments.map((i) => i.name).join(', ') : '—'}</dd>
                {m.equipment_notes && (<><dt>Equipment notes</dt><dd>{m.equipment_notes}</dd></>)}
              </dl>
            )}
            {isAdmin && expandedOutstandingId === m.id && <OutstandingClaims profileId={m.id} />}
            {isAdmin && expandedExpensesId === m.id && <MyExpenses profileId={m.id} />}
            {isAdmin && expandedIncomeId === m.id && <MyIncome profileId={m.id} />}
            {isAdmin && expandedMileageId === m.id && <MyMileage profileId={m.id} />}
            {isAdmin && expandedRepertoireId === m.id && <MyRepertoire profileId={m.id} />}
            {isAdmin && expandedTaxId === m.id && <TaxRecords profileId={m.id} />}
          </>
        )}
      </li>
    );
  }

  return (
    <div>
      <div className="section-header">
        <h2 className="section-header__title">Musicians ({bookedMusicians.length})</h2>
      </div>

      {/* Instrument filter */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16 }}>
        <label className="field__label" style={{ margin: 0, flexShrink: 0 }}>Filter by instrument:</label>
        <select
          value={filterInstrumentId}
          onChange={(e) => setFilterInstrumentId(e.target.value)}
          style={{ padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 14, background: 'var(--paper)', color: 'var(--ink)', maxWidth: 220 }}
        >
          <option value="">All instruments</option>
          {allInstruments.map((i) => (
            <option key={i.id} value={i.id}>{i.name}</option>
          ))}
        </select>
        {filterInstrumentId && (
          <button className="link-button" onClick={() => setFilterInstrumentId('')}>Clear</button>
        )}
        {filterInstrumentId && (
          <span className="field__hint">{filtered.length} result{filtered.length !== 1 ? 's' : ''}</span>
        )}
      </div>

      <p className="field__hint" style={{ marginBottom: 16 }}>
        New band members join by creating their own account from the login screen.
      </p>

      {musicians.length > 0 && (
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Search musicians…"
          resultCount={filtered.length}
          totalCount={byInstrument.length}
        />
      )}

      {loading && musicians.length === 0 ? (
        <p className="state-message">Loading musicians…</p>
      ) : error ? (
        <p className="state-message state-message--error">Couldn't load musicians: {error}</p>
      ) : filtered.length === 0 ? (
        <p className="state-message">
          {query
            ? `No musicians match "${query}".`
            : filterInstrumentId ? 'No musicians play that instrument yet.' : 'No musicians yet.'}
        </p>
      ) : (
        <>
          <ul className="simple-list">
            {bookedMusicians.map(renderMusicianItem)}
          </ul>
          {unbookedMusicians.length > 0 && (
            <>
              <p style={{ fontWeight: 600, marginTop: 24, marginBottom: 8, color: 'var(--text-muted)' }}>
                Not yet booked ({unbookedMusicians.length})
              </p>
              <ul className="simple-list">
                {unbookedMusicians.map(renderMusicianItem)}
              </ul>
            </>
          )}
        </>
      )}

      {(isAdmin || isBandLeader) && (
        <PlaceholdersSection
          filterInstrumentId={filterInstrumentId}
          isAdmin={isAdmin}
          me={me}
          gigCountsByPlaceholder={gigCountsByPlaceholder}
        />
      )}
    </div>
  );
}

// ─── Inline editable dep name ─────────────────────────────────────────────────

function DepNameEditor({ ph, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(ph.name);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  function startEdit() {
    setValue(ph.name);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  async function commit() {
    const trimmed = value.trim();
    if (!trimmed) { setValue(ph.name); setEditing(false); return; }
    if (trimmed === ph.name) { setEditing(false); return; }
    setSaving(true);
    const { error } = await supabase
      .from('placeholder_musicians')
      .update({ name: trimmed })
      .eq('id', ph.id);
    setSaving(false);
    if (error) { notify("Couldn't rename: " + error.message); return; }
    setEditing(false);
    onSaved();
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { setValue(ph.name); setEditing(false); }
  }

  if (editing) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <input
          ref={inputRef}
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          disabled={saving}
          style={{
            fontSize: 'inherit',
            fontWeight: 'inherit',
            fontFamily: 'inherit',
            padding: '2px 6px',
            border: '1px solid var(--accent, #6366f1)',
            borderRadius: 5,
            background: 'var(--paper)',
            color: 'var(--ink)',
            outline: 'none',
            minWidth: 140,
          }}
        />
        <button
          className="link-button"
          onMouseDown={(e) => { e.preventDefault(); commit(); }}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          className="link-button"
          onMouseDown={(e) => { e.preventDefault(); setValue(ph.name); setEditing(false); }}
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span
        className="simple-list__title"
        onDoubleClick={startEdit}
        title="Double-click to rename"
        style={{ cursor: 'text' }}
      >
        {ph.name}
      </span>
      <button
        className="link-button"
        onClick={startEdit}
        style={{ fontSize: 12, opacity: 0.6 }}
        title="Rename dep"
      >
        Rename
      </button>
    </span>
  );
}

// ─── Dep contact details + invite ─────────────────────────────────────────────

function DepDetailsEditor({ ph, onSaved }) {
  const [phone, setPhone] = useState(ph.phone || '');
  const [email, setEmail] = useState(ph.email || '');
  const [address, setAddress] = useState(ph.address || '');
  const [lat, setLat] = useState(ph.latitude ?? null);
  const [lon, setLon] = useState(ph.longitude ?? null);
  const [equipment, setEquipment] = useState(
    Object.fromEntries(EQUIPMENT_ITEMS.map((item) => [item.key, Boolean(ph[item.key])]))
  );
  const [equipmentNotes, setEquipmentNotes] = useState(ph.equipment_notes || '');
  const [saving, setSaving] = useState(false);
  const [showRepertoire, setShowRepertoire] = useState(false);

  async function handleSave() {
    setSaving(true);
    const { error } = await supabase
      .from('placeholder_musicians')
      .update({
        phone: phone || null,
        email: email || null,
        address: address || null,
        latitude: lat,
        longitude: lon,
        ...equipment,
        equipment_notes: equipmentNotes || null,
      })
      .eq('id', ph.id);
    setSaving(false);
    if (error) { notify("Couldn't save details: " + error.message); return; }
    onSaved();
  }

  function handleInvite() {
    window.location.href = buildInviteMailto(ph.name, email);
    // Fire-and-forget -- the mailto navigation above doesn't wait on this,
    // and shouldn't: it's just bookkeeping for the "dep never invited" task
    // (get_uninvited_dep_tasks), not something the click needs to succeed.
    supabase.from('placeholder_musicians').update({ invite_sent_at: new Date().toISOString() }).eq('id', ph.id).then(() => {});
  }

  return (
    <div style={{ marginTop: 8, padding: 10, border: '1px solid var(--line)', borderRadius: 8, background: 'var(--paper-raised)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 320 }}>
        <input placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <AddressAutocomplete
          value={address}
          onChange={(text) => { setAddress(text); setLat(null); setLon(null); }}
          onCoordinatesChange={(newLat, newLon) => { setLat(newLat); setLon(newLon); }}
          placeholder="Address (used for travel cost — start typing…)"
        />
      </div>
      <p className="field__label" style={{ marginTop: 12, marginBottom: 4 }}>Equipment they can bring</p>
      <EquipmentFields
        values={equipment}
        onToggle={(key, checked) => setEquipment((prev) => ({ ...prev, [key]: checked }))}
        notes={equipmentNotes}
        onNotesChange={setEquipmentNotes}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <button className="btn btn--primary btn--small" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save details'}
        </button>
        <button
          className="btn btn--ghost btn--small"
          onClick={handleInvite}
          title={email ? '' : 'No email saved yet — you can still fill one in when your mail app opens'}
        >
          ✉ Invite to sign up
        </button>
        <button className="btn btn--ghost btn--small" onClick={() => setShowRepertoire((v) => !v)}>
          {showRepertoire ? 'Hide repertoire' : 'Repertoire'}
        </button>
      </div>
      {showRepertoire && <PlaceholderRepertoire placeholderId={ph.id} />}
    </div>
  );
}

// ─── Deps / Placeholders ─────────────────────────────────────────────────────

function PlaceholdersSection({ filterInstrumentId, isAdmin, me, gigCountsByPlaceholder }) {
  const [placeholders, setPlaceholders] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [allInstruments, setAllInstruments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mergeTargets, setMergeTargets] = useState({});
  const [expandedDepId, setExpandedDepId] = useState(null);

  // Add new dep
  const [showAddForm, setShowAddForm] = useState(false);
  const [newDepName, setNewDepName] = useState('');
  const [newDepInstrumentId, setNewDepInstrumentId] = useState('');
  const [addingDep, setAddingDep] = useState(false);
  const [addError, setAddError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: ph }, { data: pr }, { data: insts }, { data: phInsts }] = await Promise.all([
      supabase.from('placeholder_musicians').select('id, name, phone, email, address, latitude, longitude, merged_into, created_by, has_pa, has_subs, has_iem, has_mics, has_cables, has_lighting, equipment_notes').order('name'),
      supabase.from('profiles').select('id, full_name').eq('is_active', true).order('full_name'),
      supabase.from('instruments').select('id, name').order('sort_order'),
      supabase.from('placeholder_musician_instruments').select('placeholder_id, instrument_id, instruments(name)'),
    ]);

    const withInsts = (ph || []).map((p) => ({
      ...p,
      instruments: (phInsts || [])
        .filter((pi) => pi.placeholder_id === p.id)
        .map((pi) => ({ id: pi.instrument_id, name: pi.instruments?.name }))
        .filter((i) => i.name),
    }));

    setPlaceholders(withInsts);
    setProfiles(pr || []);
    setAllInstruments(insts || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleAddNewDep(e) {
    e.preventDefault();
    const name = newDepName.trim();
    if (!name) return;
    setAddingDep(true);
    setAddError(null);

    const existing = placeholders.find((p) => p.name.trim().toLowerCase() === name.toLowerCase());
    if (existing) {
      setAddError('"' + existing.name + '" already exists in the deps list.');
      setAddingDep(false);
      return;
    }

    const { data: newPh, error: phErr } = await supabase
      .from('placeholder_musicians')
      .insert({ name, created_by: me?.id })
      .select()
      .single();
    if (phErr) { setAddError(phErr.message); setAddingDep(false); return; }

    if (newDepInstrumentId) {
      await supabase.from('placeholder_musician_instruments')
        .insert({ placeholder_id: newPh.id, instrument_id: newDepInstrumentId });
    }

    setAddingDep(false);
    setNewDepName('');
    setNewDepInstrumentId('');
    setShowAddForm(false);
    load();
  }

  async function handleAddInstrument(placeholderId, instrumentId) {
    if (!instrumentId) return;
    const { error } = await supabase.from('placeholder_musician_instruments')
      .insert({ placeholder_id: placeholderId, instrument_id: instrumentId });
    if (error) { notify("Couldn't add instrument: " + error.message); return; }
    load();
  }

  async function handleRemoveInstrument(placeholderId, instrumentId) {
    await supabase.from('placeholder_musician_instruments')
      .delete().eq('placeholder_id', placeholderId).eq('instrument_id', instrumentId);
    load();
  }

  async function handleDeleteDep(ph) {
    const ok = await confirmAsync('Delete "' + ph.name + '" from the system? This will also remove them from any gig rosters. This cannot be undone.');
    if (!ok) return;
    const { error } = await supabase.from('placeholder_musicians').delete().eq('id', ph.id);
    if (error) { notify("Couldn't delete: " + error.message); return; }
    load();
  }

  async function handleMerge(ph) {
    const targetId = mergeTargets[ph.id];
    if (!targetId) { notify('Pick a profile to merge into first.'); return; }
    const targetName = profiles.find((p) => p.id === targetId)?.full_name;
    const ok = await confirmAsync('Merge all gig history for "' + ph.name + '" into ' + targetName + '? This cannot be undone.');
    if (!ok) return;
    const { error } = await supabase.rpc('merge_placeholder_musician', {
      p_placeholder_id: ph.id,
      p_target_profile_id: targetId,
    });
    if (error) { notify("Couldn't merge: " + error.message); return; }
    load();
  }

  const active = placeholders.filter((p) => !p.merged_into);
  const merged = placeholders.filter((p) => p.merged_into);

  const byInstrument = filterInstrumentId
    ? active.filter((p) => p.instruments.some((i) => i.id === filterInstrumentId))
    : active;

  const { query, setQuery, results: filteredActive } = useFuzzySearch(byInstrument, [
    'name',
    'instruments.name',
  ]);

  // Same split as the main musicians list, and for the same reason this
  // feature exists at all: a grown deps list mixes in people who've never
  // actually played for us alongside the regulars, unless they're pulled
  // out into their own group.
  const bookedDeps = filteredActive.filter((p) => (gigCountsByPlaceholder[p.id] || 0) > 0);
  const unbookedDeps = filteredActive.filter((p) => (gigCountsByPlaceholder[p.id] || 0) === 0);

  function renderDepItem(ph) {
    const gigCount = gigCountsByPlaceholder[ph.id] || 0;
    return (
      <li className="simple-list__item" key={ph.id}>
        <div className="musician-card__title">
          <DepNameEditor ph={ph} onSaved={load} />
          <span className="musician-card__meta">{gigCount} gig{gigCount === 1 ? '' : 's'}</span>
        </div>

        {ph.instruments.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {ph.instruments.map((inst) => (
              <span className="tag" key={inst.id}>
                {inst.name}
                <button
                  type="button"
                  onClick={() => handleRemoveInstrument(ph.id, inst.id)}
                  aria-label={'Remove ' + inst.name}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <EquipmentTags values={ph} />

        {/* Always its own row, never sharing a line with the tags above --
            otherwise this select's position (and how much of the row it
            visually takes up) shifts depending on how many tags happen to
            precede it, which read as "randomly sized" even though the
            control itself was always the same width. */}
        <select
          value=""
          style={{ width: 180, marginTop: 6, fontSize: 12, padding: '3px 6px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--paper)' }}
          onChange={(e) => handleAddInstrument(ph.id, e.target.value)}
        >
          <option value="">+ Add instrument…</option>
          {allInstruments
            .filter((i) => !ph.instruments.find((pi) => pi.id === i.id))
            .map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>

        <div className="musician-card__actions">
          <button className="link-button" onClick={() => setExpandedDepId(expandedDepId === ph.id ? null : ph.id)}>
            {expandedDepId === ph.id ? 'Hide details' : (ph.phone || ph.email || ph.address ? 'View details' : '+ Add contact details')}
          </button>
          {isAdmin && (
            <>
              <select
                value={mergeTargets[ph.id] || ''}
                onChange={(e) => setMergeTargets((prev) => ({ ...prev, [ph.id]: e.target.value }))}
                style={{ width: 200, fontSize: 12, padding: '4px 6px', border: '1px solid var(--line)', borderRadius: 6 }}
              >
                <option value="">Merge into real account…</option>
                {profiles.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
              <button className="link-button" onClick={() => handleMerge(ph)}>Merge</button>
            </>
          )}
          {(isAdmin || ph.created_by === me?.id) && (
            <button className="link-button link-button--danger" onClick={() => handleDeleteDep(ph)}>
              Delete dep
            </button>
          )}
        </div>

        {expandedDepId === ph.id && <DepDetailsEditor ph={ph} onSaved={load} />}
      </li>
    );
  }

  // Only blank out on the true initial load — re-fetches after add/remove/
  // rename actions keep showing the existing list instead of unmounting the
  // whole section, which was resetting scroll position back to the top.
  if (loading && placeholders.length === 0) return null;

  return (
    <div style={{ marginTop: 32 }}>
      <div className="section-header">
        <h2 className="section-header__title">Deps &amp; session musicians ({bookedDeps.length})</h2>
        {!showAddForm && (
          <button className="btn btn--primary btn--small" onClick={() => { setShowAddForm(true); setAddError(null); }}>
            + Add new dep
          </button>
        )}
      </div>

      {showAddForm && (
        <form onSubmit={handleAddNewDep} className="inline-subform" style={{ marginBottom: 16 }}>
          <input
            placeholder="Full name (e.g. Dave Smith)"
            value={newDepName}
            onChange={(e) => setNewDepName(e.target.value)}
            required
            autoFocus
          />
          <select
            value={newDepInstrumentId}
            onChange={(e) => setNewDepInstrumentId(e.target.value)}
          >
            <option value="">Instrument (optional)…</option>
            {allInstruments.map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </select>
          {addError && <p className="form-error">{addError}</p>}
          <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
            <button type="button" className="btn btn--ghost btn--small" onClick={() => { setShowAddForm(false); setAddError(null); }}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary btn--small" disabled={addingDep}>
              {addingDep ? 'Saving…' : 'Save dep'}
            </button>
          </div>
        </form>
      )}

      <p className="field__hint" style={{ marginBottom: 16 }}>
        Deps are created automatically when added to a gig roster. Instruments added to a gig are saved here automatically.
      </p>

      {active.length > 0 && (
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Search deps…"
          resultCount={filteredActive.length}
          totalCount={byInstrument.length}
        />
      )}

      {active.length === 0 ? (
        <p className="state-message">No deps in the system yet — add them above or from a gig's roster.</p>
      ) : filteredActive.length === 0 ? (
        <p className="state-message">{query ? `No deps match "${query}".` : 'No deps play that instrument.'}</p>
      ) : (
        <>
          <ul className="simple-list">
            {bookedDeps.map(renderDepItem)}
          </ul>
          {unbookedDeps.length > 0 && (
            <>
              <p style={{ fontWeight: 600, marginTop: 24, marginBottom: 8, color: 'var(--text-muted)' }}>
                Not yet booked ({unbookedDeps.length})
              </p>
              <ul className="simple-list">
                {unbookedDeps.map(renderDepItem)}
              </ul>
            </>
          )}
        </>
      )}

      {merged.length > 0 && (
        <details style={{ marginTop: 16 }}>
          <summary className="link-button" style={{ cursor: 'pointer', userSelect: 'none' }}>
            Show {merged.length} merged dep{merged.length > 1 ? 's' : ''}
          </summary>
          <ul className="simple-list" style={{ marginTop: 8 }}>
            {merged.map((ph) => {
              const target = profiles.find((p) => p.id === ph.merged_into);
              return (
                <li className="simple-list__item" key={ph.id}>
                  <span className="simple-list__title" style={{ color: 'var(--text-muted)' }}>{ph.name}</span>
                  <span className="simple-list__subtitle">→ merged into {target?.full_name || 'unknown account'}</span>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </div>
  );
}
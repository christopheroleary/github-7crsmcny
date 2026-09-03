import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useCurrentProfile } from '../context/ProfileContext.jsx';
import { confirmAsync } from '../utils/confirmService.js';
import { notify } from '../utils/toastService.js';
import { buildInviteMailto } from '../utils/depInvite.js';

export default function BandMembers({ bandId, isAdmin }) {
  const { profile: me } = useCurrentProfile();
  const [members, setMembers] = useState([]);
  const [musicians, setMusicians] = useState([]);
  const [allPlaceholders, setAllPlaceholders] = useState([]);
  const [instruments, setInstruments] = useState([]);
  const [musicianInstruments, setMusicianInstruments] = useState({});
  const [addMode, setAddMode] = useState('musician');
  const [depMode, setDepMode] = useState('existing');
  const [newMusicianId, setNewMusicianId] = useState('');
  const [newInstrumentId, setNewInstrumentId] = useState('');
  const [newDepName, setNewDepName] = useState('');
  const [inviteLabel, setInviteLabel] = useState('');
  const [generatedLink, setGeneratedLink] = useState('');
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [pendingInvites, setPendingInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [
      { data: memberRows },
      { data: profiles },
      { data: insts },
      { data: links },
      { data: placeholders },
      { data: phInsts },
      { data: invites },
    ] = await Promise.all([
      supabase
        .from('band_members')
        .select('id, profile_id, placeholder_id, instrument_id, profiles(full_name), placeholder_musicians(name), instruments(name)')
        .eq('band_id', bandId),
      supabase.from('profiles').select('id, full_name').eq('is_active', true).order('full_name'),
      supabase.from('instruments').select('id, name').order('sort_order'),
      supabase.from('profile_instruments').select('profile_id, instrument_id, instruments(name)'),
      supabase.from('placeholder_musicians').select('id, name').is('merged_into', null).order('name'),
      supabase.from('placeholder_musician_instruments').select('placeholder_id, instrument_id, instruments(name)'),
      // Pending (unaccepted, unexpired) invite links -- so a leader can see
      // what's outstanding and cancel one that's no longer wanted, rather
      // than a token being generated once and never visible again.
      supabase
        .from('band_join_invites')
        .select('id, recipient_label, created_at, expires_at')
        .eq('band_id', bandId)
        .is('used_at', null)
        .order('created_at', { ascending: false }),
    ]);

    setMembers(memberRows || []);
    setMusicians(profiles || []);
    setInstruments(insts || []);
    setPendingInvites((invites || []).filter((i) => new Date(i.expires_at) > new Date()));

    // Map profile instruments
    const map = {};
    (links || []).forEach((l) => {
      if (!map[l.profile_id]) map[l.profile_id] = [];
      map[l.profile_id].push({ id: l.instrument_id, name: l.instruments?.name });
    });
    setMusicianInstruments(map);

    // Attach instruments to placeholders
    const phWithInsts = (placeholders || []).map((p) => ({
      ...p,
      instrumentOptions: (phInsts || [])
        .filter((pi) => pi.placeholder_id === p.id)
        .map((pi) => ({ id: pi.instrument_id, name: pi.instruments?.name })),
    }));
    setAllPlaceholders(phWithInsts);
    setLoading(false);
  }, [bandId]);

  useEffect(() => {
    load();
  }, [load]);

  function handleMusicianChange(id) {
    setNewMusicianId(id);
    setNewInstrumentId('');
  }

  async function handleAddMusician(e) {
    e.preventDefault();
    if (!newMusicianId || !newInstrumentId) return;
    setError(null);
    const { error } = await supabase.from('band_members').insert({
      band_id: bandId,
      profile_id: newMusicianId,
      placeholder_id: null,
      instrument_id: newInstrumentId,
    });
    if (error) { setError(error.message); return; }
    setNewMusicianId('');
    setNewInstrumentId('');
    load();
  }

  async function handleAddDep(e) {
    e.preventDefault();
    if (!newMusicianId || !newInstrumentId) return;
    setError(null);
    const { error } = await supabase.from('band_members').insert({
      band_id: bandId,
      profile_id: null,
      placeholder_id: newMusicianId,
      instrument_id: newInstrumentId,
    });
    if (error) { setError(error.message); return; }
    setNewMusicianId('');
    setNewInstrumentId('');
    load();
  }

  async function handleAddNewDep(e) {
    e.preventDefault();
    if (!newDepName.trim() || !newInstrumentId) return;
    setError(null);

    const existingPh = allPlaceholders.find(
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
      if (phErr) { setError(phErr.message); return; }
      phId = newPh.id;
    }

    if (members.some((m) => m.placeholder_id === phId)) {
      setError((existingPh ? existingPh.name : newDepName) + ' is already in this band.');
      return;
    }

    await supabase.from('placeholder_musician_instruments')
      .upsert(
        { placeholder_id: phId, instrument_id: newInstrumentId },
        { onConflict: 'placeholder_id,instrument_id', ignoreDuplicates: true }
      );

    const { error } = await supabase.from('band_members').insert({
      band_id: bandId,
      profile_id: null,
      placeholder_id: phId,
      instrument_id: newInstrumentId,
    });
    if (error) { setError(error.message); return; }
    setNewDepName('');
    setNewInstrumentId('');
    load();
  }

  async function handleCreateInvite(e) {
    e.preventDefault();
    setError(null);
    setCreatingInvite(true);
    setGeneratedLink('');
    const { data, error } = await supabase
      .from('band_join_invites')
      .insert({ band_id: bandId, created_by: me?.id, recipient_label: inviteLabel.trim() || null })
      .select('id')
      .single();
    setCreatingInvite(false);
    if (error) { setError(error.message); return; }
    setGeneratedLink(window.location.origin + '/?join_band=' + data.id);
    setInviteLabel('');
    load();
  }

  async function handleCopyInviteLink() {
    try {
      await navigator.clipboard.writeText(generatedLink);
      notify('Invite link copied.', 'success');
    } catch {
      // Clipboard access can fail (permissions, non-HTTPS, older browsers)
      // -- the link is still selectable/visible in the field either way.
      notify("Couldn't copy automatically -- select and copy the link instead.");
    }
  }

  async function handleCancelInvite(invite) {
    const label = invite.recipient_label ? ' "' + invite.recipient_label + '"' : '';
    const ok = await confirmAsync('Cancel this invite link' + label + '? It will stop working immediately.');
    if (!ok) return;
    const { error } = await supabase.from('band_join_invites').delete().eq('id', invite.id);
    if (error) { notify("Couldn't cancel: " + error.message); return; }
    load();
  }

  async function handleRemove(member) {
    const name = member.profiles?.full_name || member.placeholder_musicians?.name || 'this member';
    const ok = await confirmAsync('Remove ' + name + ' from this band?');
    if (!ok) return;
    const { error } = await supabase.from('band_members').delete().eq('id', member.id);
    if (error) { notify("Couldn't remove: " + error.message); return; }
    load();
  }

  if (loading) return <p className="state-message">Loading members…</p>;

  const pickedInstruments = newMusicianId
    ? addMode === 'musician'
      ? musicianInstruments[newMusicianId] || []
      : allPlaceholders.find((p) => p.id === newMusicianId)?.instrumentOptions || []
    : [];
  const availableInstruments = pickedInstruments.length > 0 ? pickedInstruments : instruments;

  return (
    <div className="band-members">
      <ul className="simple-list">
        {members.length === 0 && (
          <li className="state-message">No members yet.</li>
        )}
        {members.map((m) => {
          const isDepRow = !m.profile_id;
          const displayName = m.profiles?.full_name || m.placeholder_musicians?.name || '—';
          return (
            <li className="simple-list__item" key={m.id}>
              <div className="simple-list__row">
                <div>
                  <span className="simple-list__title">
                    {displayName}
                    {isDepRow && (
                      <span className="status-tag" style={{ marginLeft: 8, fontSize: 10, background: 'rgba(107,99,87,0.12)', color: 'var(--text-muted)' }}>
                        dep
                      </span>
                    )}
                  </span>
                  {m.instruments?.name && (
                    <span className="simple-list__subtitle">{m.instruments.name}</span>
                  )}
                </div>
                <div className="simple-list__actions">
                  {isAdmin && isDepRow && (
                    <button
                      className="link-button"
                      onClick={() => {
                        window.location.href = buildInviteMailto(displayName);
                        // Same bookkeeping as MusiciansList.jsx's identical
                        // button -- fire-and-forget, feeds the "dep never
                        // invited" task (get_uninvited_dep_tasks).
                        supabase.from('placeholder_musicians').update({ invite_sent_at: new Date().toISOString() }).eq('id', m.placeholder_id).then(() => {});
                      }}
                      title="Send them a link to create their own account -- their spot in this band carries across automatically once they sign up."
                    >
                      ✉ Invite to sign up
                    </button>
                  )}
                  {isAdmin && (
                    <button className="link-button link-button--danger" onClick={() => handleRemove(m)}>
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {isAdmin && (
        <div className="inline-subform" style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <button
              type="button"
              className={addMode === 'musician' ? 'btn btn--primary btn--small' : 'btn btn--ghost btn--small'}
              onClick={() => { setAddMode('musician'); setNewMusicianId(''); setNewInstrumentId(''); }}
            >
              Registered musician
            </button>
            <button
              type="button"
              className={addMode === 'dep' ? 'btn btn--primary btn--small' : 'btn btn--ghost btn--small'}
              onClick={() => { setAddMode('dep'); setNewMusicianId(''); setNewInstrumentId(''); }}
            >
              Dep / session
            </button>
            <button
              type="button"
              className={addMode === 'invite' ? 'btn btn--primary btn--small' : 'btn btn--ghost btn--small'}
              onClick={() => { setAddMode('invite'); setGeneratedLink(''); }}
            >
              Invite an existing musician
            </button>
          </div>

          {addMode === 'invite' ? (
            <div>
              <p className="field__hint" style={{ marginTop: 0 }}>
                For a musician who already has their own account but isn't visible in the "Registered musician" list
                above -- that list only shows people already tied to one of your bands or gigs, or who've opted into
                the dep pool. Generate a one-off link and send it to them yourself (text, WhatsApp, email, however
                you'd normally reach them). It works once, for whoever opens it, and expires in 14 days.
              </p>
              <form onSubmit={handleCreateInvite} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input
                  placeholder="Who's this for? (optional, just for your own reference)"
                  value={inviteLabel}
                  onChange={(e) => setInviteLabel(e.target.value)}
                />
                {error && <p className="form-error">{error}</p>}
                <button type="submit" className="btn btn--primary btn--small" disabled={creatingInvite}>
                  {creatingInvite ? 'Generating…' : '+ Generate invite link'}
                </button>
              </form>

              {generatedLink && (
                <div className="inline-subform" style={{ marginTop: 10 }}>
                  <p className="field__hint" style={{ marginTop: 0 }}>
                    Copy this link and send it to them directly -- it isn't sent for you.
                  </p>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input readOnly value={generatedLink} onFocus={(e) => e.target.select()} style={{ flex: 1 }} />
                    <button type="button" className="btn btn--ghost btn--small" onClick={handleCopyInviteLink}>
                      Copy
                    </button>
                  </div>
                </div>
              )}

              {pendingInvites.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <p className="field__hint" style={{ marginTop: 0, fontWeight: 700, textTransform: 'uppercase', fontSize: 11, letterSpacing: '0.04em' }}>
                    Pending invites
                  </p>
                  <ul className="simple-list">
                    {pendingInvites.map((invite) => (
                      <li className="simple-list__item" key={invite.id}>
                        <div className="simple-list__row">
                          <span className="simple-list__title">{invite.recipient_label || 'Unlabelled invite'}</span>
                          <div className="simple-list__actions">
                            <button className="link-button link-button--danger" onClick={() => handleCancelInvite(invite)}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : addMode === 'musician' ? (
            <form onSubmit={handleAddMusician} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <select
                value={newMusicianId}
                onChange={(e) => handleMusicianChange(e.target.value)}
                required
              >
                <option value="">Choose musician…</option>
                {musicians.map((p) => (
                  <option key={p.id} value={p.id}>{p.full_name}</option>
                ))}
              </select>
              <select
                value={newInstrumentId}
                onChange={(e) => setNewInstrumentId(e.target.value)}
                required
                disabled={!newMusicianId}
              >
                <option value="">
                  {newMusicianId ? 'Choose instrument…' : 'Pick a musician first'}
                </option>
                {availableInstruments.map((i) => (
                  <option key={i.id} value={i.id}>{i.name}</option>
                ))}
              </select>
              {newMusicianId && pickedInstruments.length === 0 && (
                <p className="field__hint">
                  This musician hasn't set instruments on their profile yet — showing all instruments.
                </p>
              )}
              {error && <p className="form-error">{error}</p>}
              <button type="submit" className="btn btn--primary btn--small">
                + Add to band
              </button>
            </form>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <button
                  type="button"
                  className={depMode === 'existing' ? 'btn btn--primary btn--small' : 'btn btn--ghost btn--small'}
                  onClick={() => { setDepMode('existing'); setNewMusicianId(''); setNewInstrumentId(''); setNewDepName(''); }}
                >
                  Existing dep
                </button>
                <button
                  type="button"
                  className={depMode === 'new' ? 'btn btn--primary btn--small' : 'btn btn--ghost btn--small'}
                  onClick={() => { setDepMode('new'); setNewMusicianId(''); setNewInstrumentId(''); setNewDepName(''); }}
                >
                  New dep
                </button>
              </div>

              {depMode === 'existing' ? (
                <form onSubmit={handleAddDep} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {allPlaceholders.length === 0 ? (
                    <p className="field__hint">
                      No deps in the system yet — use "New dep" to add one.
                    </p>
                  ) : (
                    <>
                      <select
                        value={newMusicianId}
                        onChange={(e) => { setNewMusicianId(e.target.value); setNewInstrumentId(''); }}
                        required
                      >
                        <option value="">Choose dep…</option>
                        {allPlaceholders.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                      {newMusicianId && (
                        <select
                          value={newInstrumentId}
                          onChange={(e) => setNewInstrumentId(e.target.value)}
                          required
                        >
                          <option value="">Choose instrument…</option>
                          {pickedInstruments.length > 0
                            ? pickedInstruments.map((i) => (
                                <option key={i.id} value={i.id}>{i.name}</option>
                              ))
                            : instruments.map((i) => (
                                <option key={i.id} value={i.id}>{i.name}</option>
                              ))
                          }
                        </select>
                      )}
                      {newMusicianId && pickedInstruments.length === 0 && (
                        <p className="field__hint">
                          No instruments set for this dep yet — go to Musicians tab to add them.
                        </p>
                      )}
                      {error && <p className="form-error">{error}</p>}
                      <button type="submit" className="btn btn--primary btn--small">
                        + Add dep to band
                      </button>
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
                    value={newInstrumentId}
                    onChange={(e) => setNewInstrumentId(e.target.value)}
                    required
                  >
                    <option value="">Choose instrument…</option>
                    {instruments.map((i) => (
                      <option key={i.id} value={i.id}>{i.name}</option>
                    ))}
                  </select>
                  <p className="field__hint">Their instrument will be saved so you can reuse them on future gigs.</p>
                  {error && <p className="form-error">{error}</p>}
                  <button type="submit" className="btn btn--primary btn--small">
                    + Add new dep to band
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useIsOffline } from '../hooks/useIsOffline.js';
import { isLikelyOfflineError } from '../utils/networkError.js';
import { confirmAsync } from '../utils/confirmService.js';
import { promptAsync } from '../utils/promptService.js';
import { notify } from '../utils/toastService.js';
import { useCurrentProfile } from '../context/ProfileContext.jsx';
import CollapsibleSection from './CollapsibleSection.jsx';
import InfoTooltip from './InfoTooltip.jsx';
import { ClaimsIcon } from '../utils/gigSectionIcons.jsx';
import NumberInput from './NumberInput.jsx';
import { CLAIM_CATEGORIES } from '../utils/claimCategories.js';
import { uploadDepInvoiceAttachment, deleteDepInvoiceAttachment } from '../utils/depInvoiceAttachment.js';
import DepInvoiceAttachmentLink from './DepInvoiceAttachmentLink.jsx';

function sortedItems(claim) {
  return [...(claim.musician_claim_items || [])].sort((a, b) => a.sort_order - b.sort_order);
}

function claimTotalPence(claim) {
  return sortedItems(claim).reduce((sum, i) => sum + i.amount_pence, 0);
}

function poundsFromPence(p) {
  return (p / 100).toFixed(2);
}

function claimantName(claim) {
  return claim.profiles?.full_name || claim.placeholder_musicians?.name || 'Unknown';
}

const STATUS_COLORS = {
  pending: 'inquiry',
  approved: 'confirmed',
  paid: 'completed',
  rejected: 'cancelled',
};

// Blank line-item editor shared by the "add a dep invoice" form -- same
// shape MusicianClaim.jsx's own editor uses, minus ReceiptLineAttach
// (that's the self-service AI-OCR image flow for a musician's own
// receipts, not relevant to attaching a dep's external invoice).
function ClaimItemsEditor({ items, setItems }) {
  function updateItem(index, patch) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }
  function addItem() {
    setItems((prev) => [...prev, { category: CLAIM_CATEGORIES[0], description: '', amountPounds: '' }]);
  }
  function removeItem(index) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <>
      {items.map((item, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 10 }}>
          <label className="field" style={{ flex: '1 1 150px', marginBottom: 0 }}>
            <span className="field__label">Category</span>
            <select value={item.category} onChange={(e) => updateItem(i, { category: e.target.value })}>
              {CLAIM_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="field" style={{ flex: '2 1 200px', marginBottom: 0 }}>
            <span className="field__label">Description</span>
            <input value={item.description} onChange={(e) => updateItem(i, { description: e.target.value })} required />
          </label>
          <label className="field" style={{ flex: '0 1 110px', marginBottom: 0 }}>
            <span className="field__label">Amount (£)</span>
            <NumberInput
              decimals={2}
              min={0}
              prefix="£"
              value={item.amountPounds}
              onChange={(e) => updateItem(i, { amountPounds: e.target.value })}
              placeholder="0.00"
              required
            />
          </label>
          <button type="button" className="link-button link-button--danger" style={{ marginBottom: 10 }} onClick={() => removeItem(i)}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="btn btn--ghost btn--small" onClick={addItem} style={{ marginBottom: 12 }}>
        + Add line
      </button>
    </>
  );
}

// New claim, or editing an existing placeholder one -- same form either
// way, just pre-seeded differently.
function DepClaimForm({ gigId, bandId, deps, editingClaim, onDone, onCancel }) {
  const [placeholderId, setPlaceholderId] = useState(editingClaim?.placeholder_id || deps[0]?.placeholder_id || '');
  const [items, setItems] = useState(() =>
    editingClaim
      ? sortedItems(editingClaim).map((i) => ({ category: i.category, description: i.description, amountPounds: poundsFromPence(i.amount_pence) }))
      : []
  );
  const [notes, setNotes] = useState(editingClaim?.notes || '');
  const [externalLink, setExternalLink] = useState(editingClaim?.external_link || '');
  const [attachmentPath, setAttachmentPath] = useState(editingClaim?.attachment_path || null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Pre-fill a Fee (+ Travel, if already calculated) line from the roster's
  // own allocation for that dep -- same convenience MusicianClaim.jsx gives
  // a real musician starting their own claim.
  useEffect(() => {
    if (editingClaim || !placeholderId) return;
    const dep = deps.find((d) => d.placeholder_id === placeholderId);
    if (!dep) return;
    const seeded = [{
      category: 'Fee',
      description: 'Performance fee' + (dep.instruments?.name ? ' — ' + dep.instruments.name : ''),
      amountPounds: dep.fee_pence ? poundsFromPence(dep.fee_pence) : '',
    }];
    if (dep.travel_cost_pence) {
      seeded.push({ category: 'Travel / mileage', description: 'Travel', amountPounds: poundsFromPence(dep.travel_cost_pence) });
    }
    setItems(seeded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeholderId]);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const oldPath = attachmentPath;
      const path = await uploadDepInvoiceAttachment(file, bandId);
      setAttachmentPath(path);
      if (oldPath) await deleteDepInvoiceAttachment(oldPath);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (!placeholderId) { setError('Choose which dep this invoice is for.'); return; }
    if (items.length === 0) { setError('Add at least one line.'); return; }

    const parsedItems = [];
    for (const it of items) {
      if (!it.description.trim()) { setError('Every line needs a description.'); return; }
      const amountPence = Math.round(Number(it.amountPounds) * 100);
      if (!amountPence || amountPence <= 0) { setError('Every line needs a valid amount.'); return; }
      parsedItems.push({ category: it.category, description: it.description.trim(), amount_pence: amountPence });
    }

    setSaving(true);
    const { error: rpcError } = editingClaim
      ? await supabase.rpc('update_placeholder_claim', {
          p_claim_id: editingClaim.id,
          p_notes: notes || null,
          p_items: parsedItems,
          p_external_link: externalLink.trim() || null,
          p_attachment_path: attachmentPath,
        })
      : await supabase.rpc('create_placeholder_claim', {
          p_gig_id: gigId,
          p_placeholder_id: placeholderId,
          p_notes: notes || null,
          p_items: parsedItems,
          p_external_link: externalLink.trim() || null,
          p_attachment_path: attachmentPath,
        });
    setSaving(false);
    if (rpcError) {
      const message = rpcError.message?.startsWith('PRO_REQUIRED: ') ? rpcError.message.slice('PRO_REQUIRED: '.length) : rpcError.message;
      setError(message);
      return;
    }
    onDone();
  }

  return (
    <form className="inline-subform" onSubmit={handleSubmit} style={{ marginBottom: 12 }}>
      <label className="field">
        <span className="field__label">Dep</span>
        <select value={placeholderId} onChange={(e) => setPlaceholderId(e.target.value)} disabled={Boolean(editingClaim)} required>
          <option value="">Choose a dep…</option>
          {deps.map((d) => <option key={d.placeholder_id} value={d.placeholder_id}>{d.placeholder_musicians?.name}</option>)}
        </select>
      </label>

      <ClaimItemsEditor items={items} setItems={setItems} />

      <p style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
        Total: <strong style={{ color: 'var(--ink)' }}>
          £{poundsFromPence(items.reduce((sum, it) => sum + (Math.round(Number(it.amountPounds) * 100) || 0), 0))}
        </strong>
      </p>

      <label className="field">
        <span className="field__label">
          Invoice link (optional)
          <InfoTooltip text="A link to the dep's own invoice, e.g. a shareable Xero link — an alternative or addition to uploading a copy below." />
        </span>
        <input
          type="url"
          value={externalLink}
          onChange={(e) => setExternalLink(e.target.value)}
          placeholder="https://..."
        />
      </label>

      <div className="field">
        <span className="field__label">Copy of their invoice (optional)</span>
        <label className="btn btn--ghost btn--small" style={{ cursor: 'pointer', display: 'inline-block' }}>
          {uploading ? 'Uploading…' : attachmentPath ? '📎 Replace file' : '📎 Attach photo or PDF'}
          <input type="file" accept="image/*,application/pdf" onChange={handleFile} disabled={uploading} style={{ display: 'none' }} />
        </label>
      </div>

      <label className="field">
        <span className="field__label">Notes (optional)</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </label>

      {error && <p className="form-error">{error}</p>}
      <div className="form-actions">
        <button type="button" className="btn btn--ghost btn--small" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn--primary btn--small" disabled={saving || uploading}>
          {saving ? 'Saving…' : editingClaim ? 'Update invoice' : 'Save invoice'}
        </button>
      </div>
    </form>
  );
}

// gig_lineup's fee_pence/travel_cost_pence are only ever READ here (to
// compare against what a musician claimed), never written, so there's no
// need to fetch them independently -- GigDetail already has them loaded
// via useOfflineGigData and passes them straight through.
export default function MusicianClaimsAdmin({ gigId, bandId, lineup: lineupProp = [], defaultOpen = false, cachedClaims = [], refreshSignal }) {
  const { isPro, isAdmin } = useCurrentProfile();
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(true);
  // Without this, a failed fetch left `claims` at its initial [] and this
  // rendered "No payment claims submitted yet" -- indistinguishable from
  // genuinely having none, when what actually happened is there's no
  // signal to check. usingCache means it fell back to cachedClaims instead
  // -- approving/rejecting/paying still needs a signal (read-only offline
  // support, no write queue), so those controls stay as they are and just
  // fail with their own error if tried.
  const [loadError, setLoadError] = useState(null);
  const [usingCache, setUsingCache] = useState(false);
  const [payingId, setPayingId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [editingClaimId, setEditingClaimId] = useState(null);

  // What the roster/fee-split view actually allocated this musician (or
  // dep) for this gig -- fee_pence + travel_cost_pence -- to compare
  // against what was claimed. Keyed by whichever id the roster row
  // actually carries; a claim looks itself up the same way it's claimed
  // (profile_id or placeholder_id), so this works identically for both.
  const expectedByClaimant = {};
  lineupProp.forEach((l) => {
    const key = l.profile_id || l.placeholder_id;
    if (key) expectedByClaimant[key] = (l.fee_pence || 0) + (l.travel_cost_pence || 0);
  });

  const deps = lineupProp.filter((l) => l.placeholder_id);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('musician_claims')
      .select('*, profiles(full_name, stripe_connect_status), placeholder_musicians(name), musician_claim_items(*)')
      .eq('gig_id', gigId)
      .order('created_at');
    if (error) {
      // A genuine (non-network) error is surfaced honestly even when
      // cachedClaims exists, rather than silently hiding it behind a
      // "connection trouble" banner that would misdescribe what actually
      // happened.
      if (cachedClaims.length > 0 && isLikelyOfflineError(error)) {
        setClaims(cachedClaims);
        setUsingCache(true);
        setLoadError(null);
      } else {
        setUsingCache(false);
        setLoadError(isLikelyOfflineError(error) ? "Couldn't load claims — no signal." : "Couldn't load claims: " + error.message);
      }
      setLoading(false);
      return;
    }
    setLoadError(null);
    setUsingCache(false);
    setClaims(data || []);
    setLoading(false);
  }, [gigId, cachedClaims]);

  // Re-fetches the moment connectivity returns, and also whenever the gig
  // page's own "↻ Refresh" button is clicked (refreshSignal).
  const isOffline = useIsOffline(load);
  useEffect(() => {
    load();
  }, [load, refreshSignal]);

  async function updateStatus(claim, status) {
    const payload = { status };

    // Guard rail: warn if approving/paying a claim for someone no longer
    // on this gig's roster (e.g. removed after they submitted the claim).
    if (status === 'approved' || status === 'paid') {
      const claimantId = claim.profile_id || claim.placeholder_id;
      const column = claim.profile_id ? 'profile_id' : 'placeholder_id';
      const { data: onRoster } = await supabase
        .from('gig_lineup')
        .select('id')
        .eq('gig_id', gigId)
        .eq(column, claimantId)
        .maybeSingle();
      if (!onRoster) {
        const name = claimantName(claim);
        const action = status === 'paid' ? 'mark it paid' : 'approve it';
        const ok = await confirmAsync(name + ' is no longer on this gig\'s roster. Still ' + action + '?');
        if (!ok) return;
      }
    }

    if (status === 'rejected') {
      const reason = await promptAsync(
        'Reason for rejecting this claim (optional, shown to the musician):',
        claim.notes || ''
      );
      if (reason === null) return; // cancelled
      payload.notes = reason || null;
    }

    const { error } = await supabase.from('musician_claims').update(payload).eq('id', claim.id);
    if (error) {
      notify("Couldn't update: " + error.message);
      return;
    }
    load();
  }

  async function handleDeleteClaim(claim) {
    const ok = await confirmAsync('Delete this invoice for ' + claimantName(claim) + '? This can\'t be undone.');
    if (!ok) return;
    if (claim.attachment_path) await deleteDepInvoiceAttachment(claim.attachment_path);
    const { error } = await supabase.from('musician_claims').delete().eq('id', claim.id);
    if (error) { notify("Couldn't delete: " + error.message); return; }
    load();
  }

  // The automated alternative to "Mark paid" -- only offered once the
  // musician's Connect account is actually active (checked server-side
  // too, this is just so the button doesn't appear for someone who isn't
  // ready yet). The claim only flips to 'paid' once Stripe confirms the
  // transfer went through -- see create-connect-transfer's own comment for
  // why that ordering matters. Never offered for a placeholder claim --
  // claim.profiles is simply absent for one, so stripe_connect_status is
  // never 'active', and the button naturally never renders.
  async function payViaStripe(claim) {
    setPayingId(claim.id);
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    const { data, error } = await supabase.functions.invoke('create-connect-transfer', {
      body: { claim_id: claim.id },
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    setPayingId(null);
    if (error || !data?.ok) {
      // supabase-js only parses the response body into `data` on a 2xx --
      // for a non-2xx it's `data: null, error: FunctionsHttpError`, whose
      // own .message is just the generic "non-2xx status code". The
      // function's actual reason (e.g. "insufficient funds") only comes
      // through by reading the raw response body error.context wraps.
      let serverMessage = data?.error || null;
      if (!serverMessage && error?.context?.json) {
        try {
          const body = await error.context.json();
          serverMessage = body?.error || null;
        } catch {
          // response body wasn't JSON -- fall through to the generic message
        }
      }
      notify("Couldn't pay via Stripe: " + (serverMessage || error?.message || 'unknown error'));
      return;
    }
    notify('Paid £' + poundsFromPence(data.amount_pence) + ' via Stripe.', 'success');
    load();
  }

  if (loading) {
    return (
      <CollapsibleSection
        id="gig-section-claims"
        title="Musician claims"
        icon={<ClaimsIcon />}
        defaultOpen={defaultOpen}
        titleExtra={<InfoTooltip text="Payment claims musicians submit after the gig — approve, reject, or pay them out (via Stripe if they're connected). You can also raise one on behalf of a dep who invoices you directly." />}
      >
        <p className="state-message" style={{ textAlign: 'left', padding: 0 }}>Loading claims…</p>
      </CollapsibleSection>
    );
  }

  const canAddDepInvoice = (isAdmin || isPro) && deps.length > 0 && !adding && !editingClaimId;
  const editingClaim = editingClaimId ? claims.find((c) => c.id === editingClaimId) : null;
  const cacheBanner = usingCache && (
    <p className="field__hint" style={{ marginBottom: 10, color: 'var(--rust)' }}>
      {isOffline ? '● Offline' : '⚠ Connection trouble'} — showing claims as they were last saved to this device. Approving, rejecting, or paying one needs a signal.
    </p>
  );

  if (loadError && !adding) return (
    <CollapsibleSection
      id="gig-section-claims"
      title="Musician claims"
      icon={<ClaimsIcon />}
      defaultOpen={defaultOpen}
      titleExtra={<InfoTooltip text="Payment claims musicians submit after the gig — approve, reject, or pay them out (via Stripe if they're connected). You can also raise one on behalf of a dep who invoices you directly." />}
    >
      <p className="form-error">{loadError}</p>
    </CollapsibleSection>
  );

  if (claims.length === 0 && !adding) return (
    <CollapsibleSection
      id="gig-section-claims"
      title="Musician claims"
      icon={<ClaimsIcon />}
      defaultOpen={defaultOpen}
      titleExtra={<InfoTooltip text="Payment claims musicians submit after the gig — approve, reject, or pay them out (via Stripe if they're connected). You can also raise one on behalf of a dep who invoices you directly." />}
    >
      {cacheBanner}
      <p className="state-message" style={{ textAlign: 'left', padding: 0 }}>No payment claims submitted yet.</p>
      {canAddDepInvoice && (
        <button type="button" className="btn btn--ghost btn--small" style={{ marginTop: 8 }} onClick={() => setAdding(true)}>
          + Add invoice for a dep
        </button>
      )}
      {adding && (
        <DepClaimForm gigId={gigId} bandId={bandId} deps={deps} editingClaim={null} onDone={() => { setAdding(false); load(); }} onCancel={() => setAdding(false)} />
      )}
    </CollapsibleSection>
  );

  const total = claims.filter((c) => c.status !== 'rejected').reduce((sum, c) => sum + claimTotalPence(c), 0);

  return (
    <CollapsibleSection
      id="gig-section-claims"
      title="Musician claims"
      icon={<ClaimsIcon />}
      defaultOpen={defaultOpen}
      titleExtra={<InfoTooltip text="Payment claims musicians submit after the gig — approve, reject, or pay them out (via Stripe if they're connected). You can also raise one on behalf of a dep who invoices you directly." />}
    >
      {cacheBanner}
      <ul className="simple-list">
        {claims.map((claim) => (
          <li className="simple-list__item" key={claim.id}>
            {editingClaimId === claim.id ? (
              <DepClaimForm
                gigId={gigId}
                bandId={bandId}
                deps={deps}
                editingClaim={claim}
                onDone={() => { setEditingClaimId(null); load(); }}
                onCancel={() => setEditingClaimId(null)}
              />
            ) : (
              <div className="simple-list__row">
                <div>
                  <span className="simple-list__title">
                    {claimantName(claim)}
                    {claim.placeholder_id && (
                      <span className="status-tag" style={{ marginLeft: 8, fontSize: 10, background: 'rgba(107,99,87,0.12)', color: 'var(--text-muted)' }}>
                        dep
                      </span>
                    )}
                    {' '}— <strong>£{poundsFromPence(claimTotalPence(claim))}</strong>
                  </span>
                  {sortedItems(claim).map((item) => (
                    <span className="simple-list__subtitle" key={item.id}>
                      {item.category} · {item.description} — £{poundsFromPence(item.amount_pence)}
                    </span>
                  ))}
                  {claim.notes && <span className="simple-list__subtitle">{claim.notes}</span>}
                  {claim.external_link && (
                    <span className="simple-list__subtitle">
                      <a href={claim.external_link} target="_blank" rel="noopener noreferrer">🔗 Invoice link</a>
                    </span>
                  )}
                  {claim.attachment_path && (
                    <span className="simple-list__subtitle"><DepInvoiceAttachmentLink path={claim.attachment_path} /></span>
                  )}
                  {claim.status === 'paid' && claim.stripe_transfer_id && (
                    <span className="status-tag status-tag--confirmed" style={{ marginTop: 4, fontSize: 10 }}>
                      Paid via Stripe
                    </span>
                  )}
                  {expectedByClaimant[claim.profile_id || claim.placeholder_id] != null && (() => {
                    const diff = claimTotalPence(claim) - expectedByClaimant[claim.profile_id || claim.placeholder_id];
                    return diff === 0 ? (
                      <span className="status-tag status-tag--confirmed" style={{ marginTop: 4 }}>
                        Matches expected (£0.00 diff)
                      </span>
                    ) : (
                      <span className="status-tag status-tag--cancelled" style={{ marginTop: 4 }}>
                        ⚠ £{poundsFromPence(Math.abs(diff))} {diff > 0 ? 'over' : 'under'} expected
                      </span>
                    );
                  })()}
                </div>
                <div className="simple-list__actions">
                  <span className={'status-tag status-tag--' + STATUS_COLORS[claim.status]}>
                    {claim.status}
                  </span>
                  {claim.placeholder_id && (claim.status === 'pending' || claim.status === 'rejected') && (
                    <button className="link-button" onClick={() => setEditingClaimId(claim.id)}>Edit</button>
                  )}
                  {claim.status === 'pending' && (
                    <>
                      <button className="link-button" onClick={() => updateStatus(claim, 'approved')}>Approve</button>
                      <button className="link-button link-button--danger" onClick={() => updateStatus(claim, 'rejected')}>Reject</button>
                    </>
                  )}
                  {claim.status === 'approved' && (
                    <>
                      {isPro && claim.profiles?.stripe_connect_status === 'active' && (
                        <button
                          className="link-button"
                          onClick={() => payViaStripe(claim)}
                          disabled={payingId === claim.id}
                        >
                          {payingId === claim.id ? 'Paying…' : 'Pay via Stripe'}
                        </button>
                      )}
                      <button className="link-button" onClick={() => updateStatus(claim, 'paid')}>Mark paid manually</button>
                    </>
                  )}
                  {claim.placeholder_id && (
                    <button className="link-button link-button--danger" onClick={() => handleDeleteClaim(claim)}>Delete</button>
                  )}
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      <p style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 13, marginTop: 8, color: 'var(--text-muted)' }}>
        Total claimed: <strong style={{ color: 'var(--ink)' }}>£{poundsFromPence(total)}</strong>
      </p>

      {canAddDepInvoice && (
        <button type="button" className="btn btn--ghost btn--small" style={{ marginTop: 8 }} onClick={() => setAdding(true)}>
          + Add invoice for a dep
        </button>
      )}
      {adding && (
        <DepClaimForm gigId={gigId} bandId={bandId} deps={deps} editingClaim={null} onDone={() => { setAdding(false); load(); }} onCancel={() => setAdding(false)} />
      )}
    </CollapsibleSection>
  );
}

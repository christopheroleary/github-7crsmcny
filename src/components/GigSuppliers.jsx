import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useCurrentProfile } from '../context/ProfileContext.jsx';
import CollapsibleSection from './CollapsibleSection.jsx';
import InfoTooltip from './InfoTooltip.jsx';
import SupplierForm from './SupplierForm.jsx';
import { confirmAsync } from '../utils/confirmService.js';
import { notify } from '../utils/toastService.js';
import { normalizeExternalUrl } from '../utils/normalizeExternalUrl.js';
import { buildSupplierFollowUpEmail, buildSupplierMailtoHref } from '../utils/supplierFollowUpEmail.js';

// Photographer, florist, DJ, caterer and the rest of the vendors working a
// gig -- tagged here so the band knows who to credit when posting photos
// (the social_url on each supplier), and so a same-visit "thanks, great
// working with you" email is one click away rather than a chore that
// never quite happens. `gig` is the already-loaded gig object (needs
// .venues.name, .gig_date, .bands.name for the email template) -- both
// GigDetail and GigDetailBandMember already have this on hand.
export default function GigSuppliers({ gigId, gig, readOnly = false, refreshSignal, defaultOpen = false }) {
  const { isAdmin, isBandLeader } = useCurrentProfile();
  const canManage = !readOnly && (isAdmin || isBandLeader);

  const [attached, setAttached] = useState([]);
  const [allSuppliers, setAllSuppliers] = useState([]);
  const [priorCounts, setPriorCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [pickedSupplierId, setPickedSupplierId] = useState('');
  const [personMetOnSite, setPersonMetOnSite] = useState('');
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  // Without this, a failed fetch left `attached` at its initial [] and
  // this rendered "No suppliers tagged yet" -- indistinguishable from
  // genuinely having none, when what actually happened is there's no
  // signal to check.
  const [loadError, setLoadError] = useState(null);

  // Split from loadAllSuppliers below: attaching/removing a supplier on
  // THIS gig never changes the supplier directory itself, so a mutation's
  // post-write refresh only needs to redo this, not the whole directory.
  const loadAttached = useCallback(async () => {
    setLoading(true);
    const { data: gs, error: loadAttachedError } = await supabase
      .from('gig_suppliers')
      .select('id, person_met_on_site, supplier_id, suppliers(*)')
      .eq('gig_id', gigId)
      .order('created_at');
    if (loadAttachedError) {
      setLoadError(navigator.onLine ? "Couldn't load suppliers: " + loadAttachedError.message : "Couldn't load suppliers — no signal.");
      setLoading(false);
      return;
    }
    setLoadError(null);
    setAttached(gs || []);

    // "Worked together before" -- does this supplier show up on any OTHER
    // gig besides this one -- drives which follow-up email tone gets used.
    if (gs && gs.length > 0) {
      const supplierIds = gs.map((r) => r.supplier_id);
      const { data: others } = await supabase
        .from('gig_suppliers')
        .select('supplier_id')
        .in('supplier_id', supplierIds)
        .neq('gig_id', gigId);
      const counts = {};
      (others || []).forEach((r) => { counts[r.supplier_id] = (counts[r.supplier_id] || 0) + 1; });
      setPriorCounts(counts);
    } else {
      setPriorCounts({});
    }
    setLoading(false);
  }, [gigId]);

  // The supplier-picker directory -- not scoped to this gig at all, so it
  // only needs loading once per mount, plus again on the one mutation that
  // can actually change it: quick-adding a brand new supplier below.
  const loadAllSuppliers = useCallback(async () => {
    if (!canManage) return;
    const { data: suppliers } = await supabase.from('suppliers').select('id, company_name, category').order('company_name');
    setAllSuppliers(suppliers || []);
  }, [canManage]);

  useEffect(() => {
    loadAttached();
    loadAllSuppliers();
    // refreshSignal is otherwise unused here -- it's a signal, not data. Both
    // GigDetail and GigDetailBandMember bump it when their top "↻ Refresh"
    // button is clicked, specifically to give this effect a reason to re-run
    // too (this component keeps its own independent fetch either way).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadAttached, loadAllSuppliers, refreshSignal]);

  function startAdd() {
    setPickedSupplierId('');
    setPersonMetOnSite('');
    setShowQuickAdd(false);
    setError(null);
    setAdding(true);
  }

  async function attachSupplier(supplierId) {
    setSaving(true);
    setError(null);
    const { error: saveError } = await supabase.from('gig_suppliers').insert({
      gig_id: gigId,
      supplier_id: supplierId,
      person_met_on_site: personMetOnSite.trim() || null,
    });
    setSaving(false);
    if (saveError) {
      setError(saveError.code === '23505' ? 'Already tagged on this gig.' : saveError.message);
      return;
    }
    setAdding(false);
    loadAttached();
  }

  function handleQuickAddSaved(newSupplier) {
    setShowQuickAdd(false);
    if (newSupplier?.id) {
      // A brand new supplier was just created -- unlike attaching an
      // existing one, this DOES change the directory, so it's refreshed
      // here too rather than just the per-gig attached list.
      loadAllSuppliers();
      attachSupplier(newSupplier.id);
    } else {
      loadAttached();
    }
  }

  async function handleRemove(row) {
    const ok = await confirmAsync(`Remove ${row.suppliers.company_name} from this gig?`);
    if (!ok) return;
    const { error: deleteError } = await supabase.from('gig_suppliers').delete().eq('id', row.id);
    if (deleteError) {
      notify("Couldn't remove: " + deleteError.message);
      return;
    }
    loadAttached();
  }

  const availableSuppliers = allSuppliers.filter((s) => !attached.some((a) => a.supplier_id === s.id));

  if (loading) return null;
  if (attached.length === 0 && !canManage) return null;

  return (
    <CollapsibleSection
      id="gig-section-suppliers"
      title="Suppliers"
      defaultOpen={defaultOpen}
      titleExtra={
        <InfoTooltip text="Photographer, florist, DJ and other vendors working this gig — tag them here so everyone knows who to credit in photos, and so a follow-up thank-you is one click away." />
      }
    >
      {loadError ? (
        <p className="form-error">{loadError}</p>
      ) : attached.length === 0 ? (
        <p className="field__hint">No suppliers tagged yet.</p>
      ) : (
        <ul className="simple-list">
          {attached.map((row) => {
            const s = row.suppliers;
            const link = normalizeExternalUrl(s.social_url);
            const hasWorkedBefore = Boolean(priorCounts[row.supplier_id]);
            const { subject, body } = buildSupplierFollowUpEmail({
              supplier: s,
              gig,
              bandName: gig?.bands?.name,
              hasWorkedBefore,
            });
            return (
              <li className="simple-list__item" key={row.id}>
                <div className="simple-list__row">
                  <div>
                    <span className="simple-list__title">{s.company_name}</span>
                    <span className="simple-list__subtitle">
                      {s.category}
                      {row.person_met_on_site ? ' · Met: ' + row.person_met_on_site : ''}
                      {hasWorkedBefore ? ' · Worked together before' : ''}
                    </span>
                    {link && (
                      <a href={link} target="_blank" rel="noopener noreferrer" className="simple-list__subtitle" style={{ display: 'block' }}>
                        {s.social_url} ↗
                      </a>
                    )}
                  </div>
                  {canManage && (
                    <div className="simple-list__actions">
                      {s.contact_email && (
                        <a className="link-button" href={buildSupplierMailtoHref(s.contact_email, subject, body)}>
                          Email follow-up
                        </a>
                      )}
                      <button className="link-button link-button--danger" onClick={() => handleRemove(row)}>Remove</button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {canManage && !adding && (
        <button className="btn btn--ghost btn--small" style={{ marginTop: 12 }} onClick={startAdd}>
          + Tag a supplier
        </button>
      )}

      {canManage && adding && (
        <div className="inline-subform" style={{ marginTop: 12 }}>
          {!showQuickAdd ? (
            <>
              <label className="field">
                <span className="field__label">Supplier</span>
                {availableSuppliers.length > 0 ? (
                  <select value={pickedSupplierId} onChange={(e) => setPickedSupplierId(e.target.value)}>
                    <option value="">Choose a supplier…</option>
                    {availableSuppliers.map((s) => (
                      <option key={s.id} value={s.id}>{s.company_name} ({s.category})</option>
                    ))}
                  </select>
                ) : (
                  <p className="field__hint">No existing suppliers to pick from yet.</p>
                )}
              </label>
              <button type="button" className="link-button" onClick={() => setShowQuickAdd(true)}>
                + Add a new supplier instead
              </button>

              <label className="field">
                <span className="field__label">Person met on site (optional)</span>
                <input value={personMetOnSite} onChange={(e) => setPersonMetOnSite(e.target.value)} placeholder="e.g. Sarah" />
              </label>

              {error && <p className="form-error">{error}</p>}
              <div className="form-actions">
                <button type="button" className="btn btn--ghost btn--small" onClick={() => setAdding(false)}>Cancel</button>
                <button
                  type="button"
                  className="btn btn--primary btn--small"
                  disabled={saving || !pickedSupplierId}
                  onClick={() => attachSupplier(pickedSupplierId)}
                >
                  {saving ? 'Adding…' : 'Add to gig'}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="field__hint" style={{ marginBottom: 8 }}>
                New supplier — saved to your directory and tagged on this gig.
              </p>
              <label className="field">
                <span className="field__label">Person met on site (optional)</span>
                <input value={personMetOnSite} onChange={(e) => setPersonMetOnSite(e.target.value)} placeholder="e.g. Sarah" />
              </label>
              <SupplierForm onSaved={handleQuickAddSaved} onCancel={() => setShowQuickAdd(false)} />
            </>
          )}
        </div>
      )}
    </CollapsibleSection>
  );
}

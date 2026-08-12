import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useCurrentProfile } from '../context/ProfileContext.jsx';
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
export default function GigSuppliers({ gigId, gig, readOnly = false }) {
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

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: gs }, { data: suppliers }] = await Promise.all([
      supabase
        .from('gig_suppliers')
        .select('id, person_met_on_site, supplier_id, suppliers(*)')
        .eq('gig_id', gigId)
        .order('created_at'),
      canManage ? supabase.from('suppliers').select('id, company_name, category').order('company_name') : Promise.resolve({ data: [] }),
    ]);
    setAttached(gs || []);
    setAllSuppliers(suppliers || []);

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
  }, [gigId, canManage]);

  useEffect(() => { load(); }, [load]);

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
    load();
  }

  function handleQuickAddSaved(newSupplier) {
    setShowQuickAdd(false);
    if (newSupplier?.id) attachSupplier(newSupplier.id);
    else load();
  }

  async function handleRemove(row) {
    const ok = await confirmAsync(`Remove ${row.suppliers.company_name} from this gig?`);
    if (!ok) return;
    const { error: deleteError } = await supabase.from('gig_suppliers').delete().eq('id', row.id);
    if (deleteError) {
      notify("Couldn't remove: " + deleteError.message);
      return;
    }
    load();
  }

  const availableSuppliers = allSuppliers.filter((s) => !attached.some((a) => a.supplier_id === s.id));

  if (loading) return null;
  if (attached.length === 0 && !canManage) return null;

  return (
    <div className="day-sheet__section" id="gig-section-suppliers">
      <h3 className="day-sheet__section-title">Suppliers</h3>
      <p className="field__hint" style={{ marginBottom: 12 }}>
        Photographer, florist, DJ and other vendors working this gig — tag them here so everyone knows who to
        credit in photos, and so a follow-up thank-you is one click away.
      </p>

      {attached.length === 0 ? (
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
    </div>
  );
}

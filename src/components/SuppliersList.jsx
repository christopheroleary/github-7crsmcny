import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useCurrentProfile } from '../context/ProfileContext.jsx';
import SupplierForm from './SupplierForm.jsx';
import SearchBox from './SearchBox.jsx';
import { useFuzzySearch } from '../hooks/useFuzzySearch.js';
import { confirmAsync } from '../utils/confirmService.js';
import { notify } from '../utils/toastService.js';
import { normalizeExternalUrl } from '../utils/normalizeExternalUrl.js';

// Every supplier tagged on any gig ends up here too (suppliers is a shared
// table, not gig-scoped) -- so this list doubles as the running vendor
// directory a band builds up over time, useful well beyond any one gig.
export default function SuppliersList() {
  const { isAdmin, profile } = useCurrentProfile();
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [editingId, setEditingId] = useState(null);

  const { query, setQuery, results: filteredSuppliers } = useFuzzySearch(suppliers, ['company_name', 'category', 'owner_name']);

  const loadSuppliers = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('suppliers').select('*').order('company_name');
    if (error) setError(error.message);
    else setSuppliers(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadSuppliers();
  }, [loadSuppliers]);

  function handleSaved() {
    setShowAddForm(false);
    setEditingId(null);
    loadSuppliers();
  }

  async function handleDelete(supplier) {
    const ok = await confirmAsync(`Delete "${supplier.company_name}"? This can't be undone.`);
    if (!ok) return;
    const { error } = await supabase.from('suppliers').delete().eq('id', supplier.id);
    if (error) {
      notify(`Couldn't delete: ${error.message}`);
      return;
    }
    loadSuppliers();
  }

  return (
    <div>
      <div className="section-header">
        <h2 className="section-header__title">Suppliers</h2>
        <button className="btn btn--primary btn--small" onClick={() => setShowAddForm((v) => !v)}>
          {showAddForm ? 'Close' : '+ Add supplier'}
        </button>
      </div>

      <p className="field__hint" style={{ marginBottom: 12 }}>
        Photographers, florists, DJs, caterers and other vendors you meet at gigs — tag them on a gig to build up a
        contact history, or add one here directly.
      </p>

      {showAddForm && <SupplierForm onSaved={handleSaved} onCancel={() => setShowAddForm(false)} />}

      {!loading && !error && suppliers.length > 0 && (
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Search suppliers…"
          resultCount={filteredSuppliers.length}
          totalCount={suppliers.length}
        />
      )}

      {loading ? (
        <p className="state-message">Loading suppliers…</p>
      ) : error ? (
        <p className="state-message state-message--error">Couldn't load suppliers: {error}</p>
      ) : suppliers.length === 0 ? (
        <p className="state-message">No suppliers yet.</p>
      ) : filteredSuppliers.length === 0 ? (
        <p className="state-message">No suppliers match "{query}".</p>
      ) : (
        <ul className="simple-list">
          {filteredSuppliers.map((s) => {
            const link = normalizeExternalUrl(s.social_url);
            return (
              <li className="simple-list__item" key={s.id}>
                {editingId === s.id ? (
                  <SupplierForm supplier={s} onSaved={handleSaved} onCancel={() => setEditingId(null)} />
                ) : (
                  <>
                    <div className="simple-list__row">
                      <div>
                        <span className="simple-list__title">{s.company_name}</span>
                        <span className="simple-list__subtitle">{s.category}</span>
                      </div>
                      <div className="simple-list__actions">
                        <button className="link-button" onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}>
                          {expandedId === s.id ? 'Hide details' : 'View details'}
                        </button>
                        {(isAdmin || s.created_by === profile?.id) && (
                          <>
                            <button className="link-button" onClick={() => setEditingId(s.id)}>Edit</button>
                            <button className="link-button link-button--danger" onClick={() => handleDelete(s)}>Delete</button>
                          </>
                        )}
                      </div>
                    </div>
                    {expandedId === s.id && (
                      <dl className="detail-list">
                        <dt>Owner</dt><dd>{s.owner_name || '—'}</dd>
                        <dt>Phone</dt><dd>{s.contact_phone || '—'}</dd>
                        <dt>Email</dt><dd>{s.contact_email || '—'}</dd>
                        <dt>Social / website</dt>
                        <dd>{link ? <a href={link} target="_blank" rel="noopener noreferrer">{s.social_url} ↗</a> : (s.social_url || '—')}</dd>
                        <dt>Notes</dt><dd>{s.notes || '—'}</dd>
                      </dl>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

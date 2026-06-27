import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import ClientForm from './ClientForm.jsx';

export default function ClientsList() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [editingId, setEditingId] = useState(null);

  const loadClients = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('clients').select('*').order('name');
    if (error) setError(error.message);
    else setClients(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadClients();
  }, [loadClients]);

  function handleSaved() {
    setShowAddForm(false);
    setEditingId(null);
    loadClients();
  }

  async function handleDelete(client) {
    const ok = window.confirm(`Delete "${client.name}"? This can't be undone.`);
    if (!ok) return;
    const { error } = await supabase.from('clients').delete().eq('id', client.id);
    if (error) {
      alert(`Couldn't delete: ${error.message}`);
      return;
    }
    loadClients();
  }

  return (
    <div>
      <div className="section-header">
        <h2 className="section-header__title">Clients</h2>
        <button className="btn btn--primary btn--small" onClick={() => setShowAddForm((v) => !v)}>
          {showAddForm ? 'Close' : '+ Add client'}
        </button>
      </div>

      {showAddForm && <ClientForm onSaved={handleSaved} onCancel={() => setShowAddForm(false)} />}

      {loading ? (
        <p className="state-message">Loading clients…</p>
      ) : error ? (
        <p className="state-message state-message--error">Couldn't load clients: {error}</p>
      ) : clients.length === 0 ? (
        <p className="state-message">No clients yet.</p>
      ) : (
        <ul className="simple-list">
          {clients.map((c) => (
            <li className="simple-list__item" key={c.id}>
              {editingId === c.id ? (
                <ClientForm client={c} onSaved={handleSaved} onCancel={() => setEditingId(null)} />
              ) : (
                <>
                  <div className="simple-list__row">
                    <div>
                      <span className="simple-list__title">{c.name}</span>
                      {c.email && <span className="simple-list__subtitle">{c.email}</span>}
                    </div>
                    <div className="simple-list__actions">
                      <button className="link-button" onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}>
                        {expandedId === c.id ? 'Hide details' : 'View details'}
                      </button>
                      <button className="link-button" onClick={() => setEditingId(c.id)}>Edit</button>
                      <button className="link-button link-button--danger" onClick={() => handleDelete(c)}>Delete</button>
                    </div>
                  </div>
                  {expandedId === c.id && (
                    <dl className="detail-list">
                      <dt>Phone</dt><dd>{c.phone || '—'}</dd>
                      <dt>Billing notes</dt><dd>{c.billing_notes || '—'}</dd>
                    </dl>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
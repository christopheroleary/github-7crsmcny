import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { formatShortDate } from '../utils/formatDate.js';
import GigForm from './GigForm.jsx';

const STATUS_COLOURS = {
  new: 'inquiry', contacted: 'inquiry', converted: 'confirmed', declined: 'cancelled',
};

export default function EnquiriesList() {
  const [enquiries, setEnquiries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [convertingEnq, setConvertingEnq] = useState(null); // ← new

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('enquiries')
      .select('*')
      .order('created_at', { ascending: false });
    setEnquiries(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function updateStatus(id, status) {
    await supabase.from('enquiries').update({ status }).eq('id', id);
    load();
  }

  async function saveNotes(id, notes) {
    await supabase.from('enquiries').update({ admin_notes: notes }).eq('id', id);
  }

  async function handleGigSaved(gigId, enquiryId) {
    await supabase.from('enquiries').update({ status: 'converted' }).eq('id', enquiryId);
    setConvertingEnq(null);
    setExpandedId(null);
    load();
  }

  // Build a prefill object shaped like GigForm expects
  function buildPrefill(enq) {
    return {
      _isConvert: true,           // flag so GigForm doesn't treat as edit
      gig_date: enq.event_date || '',
      status: 'inquiry',
      fee_amount: enq.estimated_budget ?? '',
      notes: [
        enq.requirements,
        enq.admin_notes,
      ].filter(Boolean).join('\n\n') || '',
      // venue / client handled via quick-add in the form
      _venueHint: enq.venue_name || '',
      _clientHint: enq.client_name || '',
      _clientEmail: enq.client_email || '',
      _clientPhone: enq.client_phone || '',
    };
  }

  if (convertingEnq) {
    return (
      <div>
        <div className="section-header">
          <h2 className="section-header__title">Convert enquiry → gig</h2>
          <span className="field__hint">from {convertingEnq.client_name}</span>
        </div>
        <p className="field__hint" style={{ marginBottom: 12 }}>
          Details pre-filled from the enquiry. Complete any missing fields then save.
        </p>
        <GigForm
          gig={buildPrefill(convertingEnq)}
          onSaved={(gigId) => handleGigSaved(gigId, convertingEnq.id)}
          onCancel={() => setConvertingEnq(null)}
        />
      </div>
    );
  }

  return (
    <div>
      <div className="section-header">
        <h2 className="section-header__title">Enquiries</h2>
        <span className="field__hint">{enquiries.filter(e => e.status === 'new').length} new</span>
      </div>

      {loading ? (
        <p className="state-message">Loading enquiries…</p>
      ) : enquiries.length === 0 ? (
        <p className="state-message">No enquiries yet. Share your enquiry link to get started.</p>
      ) : (
        <>
          <div className="enquiry-share-hint">
            <span>📋 Share your enquiry form:</span>
            <code className="enquiry-url">{window.location.origin}/enquiry</code>
            <button
              className="btn btn--ghost btn--small"
              onClick={() => navigator.clipboard.writeText(window.location.origin + '/enquiry')}
            >
              Copy link
            </button>
          </div>

          <ul className="simple-list">
            {enquiries.map(enq => (
              <li className="simple-list__item" key={enq.id}>
                <div className="simple-list__row">
                  <div>
                    <span className="simple-list__title">{enq.client_name}</span>
                    <span className="simple-list__subtitle">
                      {enq.event_date ? formatShortDate(enq.event_date) : 'Date TBC'}
                      {enq.venue_name ? ' · ' + enq.venue_name : ''}
                      {enq.estimated_budget ? ' · £' + Math.round(enq.estimated_budget).toLocaleString('en-GB') : ''}
                    </span>
                  </div>
                  <div className="simple-list__actions">
                    <span className={'status-tag status-tag--' + STATUS_COLOURS[enq.status]}>{enq.status}</span>
                    <button className="link-button" onClick={() => setExpandedId(expandedId === enq.id ? null : enq.id)}>
                      {expandedId === enq.id ? 'Close' : 'View'}
                    </button>
                  </div>
                </div>

                {expandedId === enq.id && (
                  <div className="enquiry-detail">
                    <dl className="detail-list">
                      <dt>Email</dt><dd>{enq.client_email || '—'}</dd>
                      <dt>Phone</dt><dd>{enq.client_phone || '—'}</dd>
                      <dt>Event type</dt><dd>{enq.event_type || '—'}</dd>
                      <dt>Venue</dt><dd>{enq.venue_name || '—'}{enq.venue_address ? ', ' + enq.venue_address : ''}</dd>
                      <dt>Date</dt><dd>{enq.event_date ? formatShortDate(enq.event_date) : '—'}</dd>
                      <dt>Budget</dt><dd>{enq.estimated_budget ? '£' + Math.round(enq.estimated_budget).toLocaleString('en-GB') : '—'}</dd>
                      <dt>Band size</dt><dd>{enq.band_size || '—'}</dd>
                      <dt>Requirements</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{enq.requirements || '—'}</dd>
                      <dt>Received</dt><dd>{new Date(enq.created_at).toLocaleDateString('en-GB')}</dd>
                    </dl>

                    <label className="field" style={{ marginTop: 10 }}>
                      <span className="field__label">Admin notes</span>
                      <textarea
                        defaultValue={enq.admin_notes || ''}
                        onBlur={(e) => saveNotes(enq.id, e.target.value)}
                        rows={2}
                      />
                    </label>

                    <div className="form-actions" style={{ justifyContent: 'flex-start', gap: 8, marginTop: 10 }}>
                      {enq.status === 'new' && (
                        <button className="btn btn--ghost btn--small" onClick={() => updateStatus(enq.id, 'contacted')}>
                          Mark contacted
                        </button>
                      )}
                      {enq.status !== 'converted' && (
                        <>
                          <button
                            className="btn btn--primary btn--small"
                            onClick={() => setConvertingEnq(enq)}  // ← replaces old "Mark converted"
                          >
                            Convert to gig
                          </button>
                          <button
                            className="btn btn--ghost btn--small"
                            onClick={() => updateStatus(enq.id, 'converted')}
                          >
                            Mark converted (no gig)
                          </button>
                        </>
                      )}
                      {enq.status !== 'declined' && (
                        <button className="btn btn--ghost btn--small" onClick={() => updateStatus(enq.id, 'declined')}
                          style={{ color: 'var(--rust)' }}>
                          Decline
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
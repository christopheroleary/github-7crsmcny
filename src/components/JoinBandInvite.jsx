import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

// Landing screen for a band-invite link (?join_band=<token>, generated from
// BandMembers' "Invite an existing musician"). Deliberately shows exactly
// who's asking and which band before anything happens -- accepting is a
// real decision (it grants that band's leader the same visibility any
// bandmate/gigmate already has: name, phone, home address, equipment --
// never bank details, see get_payment_details in
// 20260826130000_restrict_sensitive_profile_columns.sql), so this is never
// a silent auto-join, and there's always an obvious way to back out if the
// person doesn't recognise the invite.
export default function JoinBandInvite({ token, onDone }) {
  const [preview, setPreview] = useState(null); // { band_name, invited_by, status } | 'not_found'
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState(null);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const { data, error } = await supabase.rpc('get_band_invite_preview', { p_token: token });
      if (cancelled) return;
      if (error || !data || data.length === 0) {
        setPreview('not_found');
      } else {
        setPreview(data[0]);
      }
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [token]);

  async function handleAccept() {
    setAccepting(true);
    setError(null);
    const { error } = await supabase.rpc('accept_band_invite', { p_token: token });
    setAccepting(false);
    if (error) { setError(error.message); return; }
    setAccepted(true);
  }

  const bodyStatus = preview === 'not_found' ? 'not_found' : preview?.status;

  return (
    <div className="modal-overlay" onClick={accepted ? onDone : undefined}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <h3 className="day-sheet__section-title" style={{ marginTop: 0 }}>Band invite</h3>

        {loading && <p className="state-message">Checking invite…</p>}

        {!loading && bodyStatus === 'not_found' && (
          <>
            <p>This invite link isn't valid. It may have been cancelled -- ask whoever sent it for a new one.</p>
            <div className="form-actions">
              <button type="button" className="btn btn--primary" onClick={onDone}>Close</button>
            </div>
          </>
        )}

        {!loading && bodyStatus === 'expired' && (
          <>
            <p>This invite link has expired. Ask whoever sent it for a new one.</p>
            <div className="form-actions">
              <button type="button" className="btn btn--primary" onClick={onDone}>Close</button>
            </div>
          </>
        )}

        {!loading && bodyStatus === 'used' && (
          <>
            <p>This invite link has already been used.</p>
            <div className="form-actions">
              <button type="button" className="btn btn--primary" onClick={onDone}>Close</button>
            </div>
          </>
        )}

        {!loading && bodyStatus === 'valid' && !accepted && (
          <>
            <p>
              <strong>{preview.invited_by}</strong> wants to add you as a standing member of{' '}
              <strong>{preview.band_name}</strong> -- they'll be able to see your name, phone and address the same as
              anyone else you've already worked a gig with, and pick you straight from that band's roster on future
              gigs.
            </p>
            <p className="field__hint">
              Don't recognise {preview.invited_by}? It's safe to decline -- nothing happens unless you accept.
            </p>
            {error && <p className="form-error">{error}</p>}
            <div className="form-actions">
              <button type="button" className="link-button" onClick={onDone}>Decline</button>
              <button type="button" className="btn btn--primary" onClick={handleAccept} disabled={accepting}>
                {accepting ? 'Joining…' : 'Accept and join'}
              </button>
            </div>
          </>
        )}

        {accepted && (
          <>
            <p className="form-success">You're in -- {preview.band_name} can now add you to gigs directly.</p>
            <div className="form-actions">
              <button type="button" className="btn btn--primary" onClick={onDone}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

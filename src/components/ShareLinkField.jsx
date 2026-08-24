import { useState } from 'react';
import { supabase } from '../supabaseClient';
import { confirmAsync } from '../utils/confirmService.js';
import { notify } from '../utils/toastService.js';
import { friendlyDbError } from '../utils/friendlyDbError.js';

function formatExpiry(expiresAt, revokedAt) {
  if (revokedAt) return 'This link has been revoked and no longer opens.';
  if (!expiresAt) return 'This link does not expire.';
  const d = new Date(expiresAt);
  const expired = d <= new Date();
  const when = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  return expired ? 'This link expired on ' + when + '.' : 'This link works until ' + when + '.';
}

/**
 * The client-facing share link for an invoice, quote or contract, with the
 * controls to withdraw it.
 *
 * Share tokens used to be permanent and irrevocable: a link sent to the
 * wrong address, forwarded on, or left in a shared inbox kept working
 * forever, and for invoices it carried the band's sort code and account
 * number. Rotating issues a fresh link and kills the old one; revoking
 * kills the link outright when no replacement is wanted. Both go through
 * SECURITY DEFINER RPCs that re-check the caller leads the owning band.
 *
 * `docType` is one of 'invoice' | 'quote' | 'contract' and matches both the
 * public route prefix and the RPC's p_doc_type argument.
 */
export default function ShareLinkField({ docType, doc, onChange, label = 'Client view link' }) {
  const [busy, setBusy] = useState(false);

  const url = window.location.origin + '/' + docType + '/' + doc.share_token;
  const revoked = Boolean(doc.share_token_revoked_at);
  const expired =
    !revoked && doc.share_token_expires_at && new Date(doc.share_token_expires_at) <= new Date();
  const dead = revoked || expired;

  async function rotate() {
    const ok = await confirmAsync(
      'Issue a new link? The current link will stop working immediately, so anyone you already sent it to will need the new one.'
    );
    if (!ok) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('rotate_share_token', {
      p_doc_type: docType,
      p_doc_id: doc.id,
    });
    setBusy(false);
    if (error) { notify(friendlyDbError(error)); return; }
    notify('New link issued. The old one no longer works.');
    onChange?.({ ...doc, share_token: data, share_token_revoked_at: null });
  }

  async function revoke() {
    const ok = await confirmAsync(
      'Revoke this link? It will stop working immediately and no new link is issued. You can issue a new one afterwards if you need to.'
    );
    if (!ok) return;
    setBusy(true);
    const { error } = await supabase.rpc('revoke_share_token', {
      p_doc_type: docType,
      p_doc_id: doc.id,
    });
    setBusy(false);
    if (error) { notify(friendlyDbError(error)); return; }
    notify('Link revoked.');
    onChange?.({ ...doc, share_token_revoked_at: new Date().toISOString() });
  }

  return (
    <div className="field" style={{ marginTop: 12 }}>
      <span className="field__label">{label}</span>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          value={url}
          readOnly
          style={{
            flex: 1,
            padding: '8px 10px',
            border: '1px solid var(--line)',
            borderRadius: 8,
            fontSize: 13,
            background: 'var(--paper)',
            fontFamily: 'var(--font-mono)',
            // Dim a link that no longer resolves, so it's obvious at a
            // glance that copying it would send the client to a dead page.
            opacity: dead ? 0.5 : 1,
          }}
        />
        <button
          type="button"
          className="btn btn--ghost btn--small"
          disabled={dead}
          onClick={() => navigator.clipboard.writeText(url)}
        >
          Copy
        </button>
      </div>
      <p className="field__hint" style={{ marginTop: 6 }}>
        {formatExpiry(doc.share_token_expires_at, doc.share_token_revoked_at)}
      </p>
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <button type="button" className="btn btn--ghost btn--small" disabled={busy} onClick={rotate}>
          {dead ? 'Issue new link' : 'Replace link'}
        </button>
        {!dead && (
          <button type="button" className="btn btn--ghost btn--small" disabled={busy} onClick={revoke}>
            Revoke link
          </button>
        )}
      </div>
    </div>
  );
}

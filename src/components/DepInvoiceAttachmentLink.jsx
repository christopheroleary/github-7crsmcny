import { useEffect, useState } from 'react';
import { depInvoiceSignedUrl } from '../utils/depInvoiceAttachment.js';

// Shared between MusicianClaimsAdmin.jsx (the leader's view of any claim)
// and MusicianClaim.jsx (a musician's own view of their own claim --
// reachable once a placeholder claim's dep merges into a real account, see
// dep_invoices_storage_read's third clause, which grants exactly that).
//
// 'loading' | 'ready' | 'failed' -- depInvoiceSignedUrl resolves to null on
// any error (file missing, RLS denies it, expired path), which a bare
// `url` check can't tell apart from "still loading", leaving this stuck on
// a permanently misleading "Loading…" forever. Caught live once already.
export default function DepInvoiceAttachmentLink({ path }) {
  const [status, setStatus] = useState('loading');
  const [url, setUrl] = useState(null);

  useEffect(() => {
    let active = true;
    setStatus('loading');
    depInvoiceSignedUrl(path).then((u) => {
      if (!active) return;
      setUrl(u);
      setStatus(u ? 'ready' : 'failed');
    });
    return () => { active = false; };
  }, [path]);

  if (status === 'loading') return <span className="field__hint">Loading attachment…</span>;
  if (status === 'failed') return <span className="field__hint" style={{ color: 'var(--rust)' }}>⚠ Attachment unavailable</span>;
  return <a href={url} target="_blank" rel="noopener noreferrer">📎 View attached invoice</a>;
}

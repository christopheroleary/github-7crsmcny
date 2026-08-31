import { useState } from 'react';
import { supabase } from '../supabaseClient';
import { useCurrentProfile } from '../context/ProfileContext.jsx';

// One place both band leaders and musicians see + manage their own £1/month
// Pro subscription -- what it unlocks differs by role, but the billing
// mechanics (checkout, portal, status) are identical either way.
export default function ProSubscription() {
  const { profile, isAdmin, isBandLeader, isPro } = useCurrentProfile();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!profile) return null;

  // Admins already have full access everywhere -- nothing to sell them.
  if (isAdmin) return null;

  async function callFunction(name) {
    setError(null);
    setBusy(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    const { data, error: fnError } = await supabase.functions.invoke(name, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (fnError || !data?.url) {
      setBusy(false);
      // Same non-2xx unwrapping used by ConnectPayoutSetup/MusicianClaimsAdmin
      // -- supabase-js only parses the response body into `data` on a 2xx.
      let serverMessage = data?.error || null;
      if (!serverMessage && fnError?.context?.json) {
        try {
          const body = await fnError.context.json();
          serverMessage = body?.error || null;
        } catch {
          // response body wasn't JSON -- fall through to the generic message
        }
      }
      setError(serverMessage || fnError?.message || 'Something went wrong');
      return;
    }
    window.location.href = data.url;
  }

  const benefits = isBandLeader
    ? ['Quotes, contracts and invoicing', 'Accepting client payments via Stripe', 'Paying musicians via Stripe', 'The dep finder wizard', 'More than 12 gigs per band']
    : ['One-click claims to your band leader', 'Making Tax Digital records for Self Assessment'];

  return (
    <div className="day-sheet__section">
      <h3 className="day-sheet__section-title">Seeau Pro</h3>

      {isPro ? (
        <>
          <p className="form-success" style={{ marginBottom: 10 }}>You're on Pro — £1/month.</p>
          {error && <p className="form-error">{error}</p>}
          <button className="btn btn--ghost btn--small" onClick={() => callFunction('create-portal-session')} disabled={busy}>
            {busy ? 'Opening…' : 'Manage subscription'}
          </button>
        </>
      ) : (
        <>
          <p className="field__hint" style={{ marginBottom: 8 }}>£1/month unlocks:</p>
          <ul style={{ margin: '0 0 12px', paddingLeft: 18 }}>
            {benefits.map((b) => (
              <li key={b} className="field__hint">{b}</li>
            ))}
          </ul>
          {error && <p className="form-error">{error}</p>}
          <button className="btn btn--primary btn--small" onClick={() => callFunction('create-subscription-checkout')} disabled={busy}>
            {busy ? 'Redirecting…' : 'Upgrade to Pro — £1/month'}
          </button>
        </>
      )}
    </div>
  );
}

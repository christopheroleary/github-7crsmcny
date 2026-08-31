import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

const STATUS_LABEL = {
  active: 'Payouts are set up — Stripe will pay you directly when a claim is approved.',
  pending: "You've started setup, but Stripe still needs more information before payouts can go through.",
  restricted: 'Stripe needs more information from you before payouts can resume.',
};

// Sits alongside ProfilePaymentDetails (manual bank details), not in place
// of it -- placeholder/dep musicians and anyone who hasn't set this up yet
// still get paid the existing way. See connect-recommend-plan.md.
//
// Uses Stripe's Account Links (a plain server-redirect flow), not embedded
// components -- the embedded onboarding widget currently fails with "An
// error occurred while authenticating your account" on this account's
// Sandbox-mode keys, a known open bug in Connect.js's popup-based
// authentication step, not something fixable from this app's side.
export default function ConnectPayoutSetup({ paymentDetails }) {
  const [status, setStatus] = useState(paymentDetails?.stripe_connect_status || null); // null | 'pending' | 'active' | 'restricted'
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState(null);

  // paymentDetails is fetched once by Money.jsx (a single get_payment_details
  // call shared with ProfilePaymentDetails, which used to each fetch it
  // independently) and passed down here instead of this component fetching
  // its own copy.
  useEffect(() => {
    setStatus(paymentDetails?.stripe_connect_status || null);

    // Belt-and-braces: if there's an account but it's not showing active
    // yet, re-check with Stripe directly rather than relying solely on
    // the account.updated webhook -- catches a missed or not-yet-existing
    // webhook delivery (exactly what happened setting this up: onboarding
    // finished before the endpoint was registered) without needing a
    // manual fix. Once status is active there's nothing left to chase,
    // so this doesn't run on every load forever.
    if (paymentDetails?.stripe_connect_account_id && paymentDetails.stripe_connect_status !== 'active') {
      (async () => {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        const { data: syncData } = await supabase.functions.invoke('sync-connect-status', {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (syncData?.status) setStatus(syncData.status);
      })();
    }
  }, [paymentDetails]);

  async function startOnboarding() {
    setError(null);
    setRedirecting(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    const { data, error: fnError } = await supabase.functions.invoke('create-connect-account', {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (fnError || !data?.url) {
      setRedirecting(false);
      // Same non-2xx unwrapping as MusicianClaimsAdmin's payViaStripe --
      // supabase-js's error.message is a generic "non-2xx status code" for
      // any failure; the function's actual reason is in the response body.
      let serverMessage = data?.error || null;
      if (!serverMessage && fnError?.context?.json) {
        try {
          const body = await fnError.context.json();
          serverMessage = body?.error || null;
        } catch {
          // response body wasn't JSON -- fall through to the generic message
        }
      }
      setError(serverMessage || fnError?.message || 'Could not start payout setup');
      return;
    }
    // Full navigation, not a soft redirect -- same pattern as the invoice
    // "Pay now" flow. Stripe's own return_url brings the browser straight
    // back here once onboarding is done (or abandoned).
    window.location.href = data.url;
  }

  return (
    <div className="day-sheet__section">
      <h3 className="day-sheet__section-title">Automatic payouts</h3>
      <p className="field__hint" style={{ marginBottom: 12 }}>
        Set this up once and get paid straight to your bank via Stripe as soon as a
        claim is approved — no need to wait for a manual bank transfer.
      </p>

      {status && (
        <p className={status === 'active' ? 'form-success' : 'field__hint'} style={{ marginBottom: 10 }}>
          {STATUS_LABEL[status] || STATUS_LABEL.pending}
        </p>
      )}

      {error && <p className="form-error">{error}</p>}

      <button className="btn btn--ghost btn--small" onClick={startOnboarding} disabled={redirecting}>
        {redirecting ? 'Redirecting…' : status ? 'Manage payout setup' : 'Set up payouts'}
      </button>
    </div>
  );
}

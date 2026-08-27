import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

const STATUS_LABEL = {
  active: "Payouts are set up — a client's card payment on this band's invoices goes straight to this band's own bank account.",
  pending: "Setup has started, but Stripe still needs more information before payouts can go through.",
  restricted: 'Stripe needs more information before payouts can resume.',
};

// Band-level counterpart to ConnectPayoutSetup, rendered in BandForm. Only
// matters for a band led by someone other than the platform admin -- an
// admin-led (or leaderless) band's invoices are always paid directly into
// the platform account, so there's nothing to set up here, but the section
// is still shown (rather than hidden) so that's explained rather than
// silently absent.
export default function BandConnectPayoutSetup({ band, onChange }) {
  const [status, setStatus] = useState(band?.stripe_connect_status || null);
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setStatus(band?.stripe_connect_status || null);

    // Same belt-and-braces self-heal as ConnectPayoutSetup: the
    // account.updated webhook is the primary way this stays current, but
    // can be missed or delayed.
    if (band?.stripe_connect_account_id && band.stripe_connect_status !== 'active') {
      (async () => {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        const { data: syncData } = await supabase.functions.invoke('sync-band-connect-status', {
          body: { band_id: band.id },
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (syncData?.status) {
          setStatus(syncData.status);
          onChange?.({ ...band, stripe_connect_status: syncData.status });
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [band?.id, band?.stripe_connect_account_id, band?.stripe_connect_status]);

  async function startOnboarding() {
    setError(null);
    setRedirecting(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    const { data, error: fnError } = await supabase.functions.invoke('create-band-connect-account', {
      body: { band_id: band.id },
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (fnError || !data?.url) {
      setRedirecting(false);
      // Same non-2xx unwrapping as ConnectPayoutSetup -- supabase-js's
      // error.message is a generic "non-2xx status code" for any failure;
      // the function's actual reason is in the response body.
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
    // "Pay now" flow and ConnectPayoutSetup. Stripe's own return_url brings
    // the browser straight back to this band once onboarding is done.
    window.location.href = data.url;
  }

  if (!band?.id) return null;

  return (
    <div style={{ marginTop: 16 }}>
      <p className="field__label" style={{ marginBottom: 6 }}>Stripe payouts</p>
      <p className="field__hint" style={{ marginBottom: 10 }}>
        If this band is run by someone other than you, they can set this up so a client's card
        payment on this band's invoices goes straight to this band's own bank account, instead of
        yours. Not needed if you lead this band yourself.
      </p>

      {status && (
        <p className={status === 'active' ? 'form-success' : 'field__hint'} style={{ marginBottom: 10 }}>
          {STATUS_LABEL[status] || STATUS_LABEL.pending}
        </p>
      )}

      {error && <p className="form-error">{error}</p>}

      <button type="button" className="btn btn--ghost btn--small" onClick={startOnboarding} disabled={redirecting}>
        {redirecting ? 'Redirecting…' : status ? 'Manage payout setup' : 'Set up payouts'}
      </button>
    </div>
  );
}

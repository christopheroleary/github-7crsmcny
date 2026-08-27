import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// Same v20 pin as create-connect-account -- the v2 Accounts API this
// function needs wasn't added to stripe-node until 20.1.0.
import Stripe from 'https://esm.sh/stripe@20?target=deno';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
// New-style secret key, not the legacy service_role JWT -- see
// notify-admin/index.ts for why every function was migrated off it.
const SUPABASE_SERVICE_KEY = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')!)['secret'];
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!;
// Same var + trailing-slash handling as create-connect-account.
const APP_URL = (Deno.env.get('APP_URL') || 'http://localhost:5173').replace(/\/+$/, '');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2026-07-29.dahlia' });

// Band-level counterpart to create-connect-account: a band's own Connect
// account, so an independently-led band's invoice payments can go straight
// to its own bank account instead of the platform's. Called from
// BandConnectPayoutSetup (rendered in BandForm) by any co-leader of the
// band, or an admin -- unlike the profile-level flow, more than one person
// can legitimately click "Set up payouts" for the same band, so account
// creation is guarded against two co-leaders racing each other (see below).
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const { band_id } = await req.json();
    if (!band_id) {
      return new Response(JSON.stringify({ error: 'Invalid request' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await callerClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Not signed in' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Authorization check runs on the CALLER's own JWT-scoped client, same
    // pattern as create-connect-transfer's claim lookup -- is_band_leader_of
    // and is_admin are both existing SECURITY DEFINER RPCs already exposed
    // to authenticated callers.
    const [{ data: isLeader }, { data: isAdmin }] = await Promise.all([
      callerClient.rpc('is_band_leader_of', { p_band_id: band_id }),
      callerClient.rpc('is_admin'),
    ]);
    if (!isLeader && !isAdmin) {
      return new Response(JSON.stringify({ error: 'You are not a leader of this band' }), {
        status: 403,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const { data: band, error: bandError } = await admin
      .from('bands')
      .select('id, name, contact_email, stripe_connect_account_id')
      .eq('id', band_id)
      .single();

    if (bandError || !band) {
      return new Response(JSON.stringify({ error: 'Band not found' }), {
        status: 404,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    let accountId = band.stripe_connect_account_id;

    if (!accountId) {
      // Recipient-only account -- same shape as create-connect-account:
      // the band receives transfers, it never processes a payment itself.
      const account = await stripe.v2.core.accounts.create({
        contact_email: band.contact_email || user.email,
        display_name: band.name || undefined,
        dashboard: 'express',
        identity: { country: 'gb' },
        configuration: {
          recipient: {
            capabilities: {
              stripe_balance: { stripe_transfers: { requested: true } },
            },
          },
        },
        defaults: {
          currency: 'gbp',
          responsibilities: {
            fees_collector: 'application',
            losses_collector: 'application',
          },
        },
      });

      accountId = account.id;

      // Guarded update, not a plain one: two co-leaders can genuinely click
      // "Set up payouts" for the same band at once (the single-profile flow
      // never had this problem -- only the profile's own owner could ever
      // call it). Only the first write wins; the loser re-reads whichever
      // account id actually landed instead of creating a second, orphaned
      // Stripe account that nothing ever points at.
      const { data: won, error: updateError } = await admin
        .from('bands')
        .update({ stripe_connect_account_id: accountId, stripe_connect_status: 'pending' })
        .eq('id', band_id)
        .is('stripe_connect_account_id', null)
        .select('id')
        .maybeSingle();
      if (updateError) throw updateError;

      if (!won) {
        const { data: refetched, error: refetchError } = await admin
          .from('bands')
          .select('stripe_connect_account_id')
          .eq('id', band_id)
          .single();
        if (refetchError) throw refetchError;
        accountId = refetched.stripe_connect_account_id;
      }
    }

    // Account Links (hosted redirect), same reasoning as create-connect-account:
    // embedded onboarding currently fails on this account's Sandbox-mode keys.
    // A distinct query flag (stripe_connect_band, not stripe_connect) so
    // App.jsx can tell this apart from the profile-level return trip.
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      type: 'account_onboarding',
      refresh_url: `${APP_URL}/?stripe_connect_band=1&band_id=${band_id}`,
      return_url: `${APP_URL}/?stripe_connect_band=1&band_id=${band_id}`,
    });

    return new Response(JSON.stringify({ url: accountLink.url }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('create-band-connect-account error:', err);
    const message = err instanceof Stripe.errors.StripeError ? err.message : 'Something went wrong. Please try again.';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});

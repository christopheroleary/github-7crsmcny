import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// Pinned to @17 elsewhere in this project (create-invoice-checkout,
// stripe-webhook), but the v2 Accounts API (stripe.v2.core.accounts) this
// function needs wasn't added to stripe-node until 20.1.0 -- bumped here
// specifically, not project-wide, since nothing else actually needs it.
import Stripe from 'https://esm.sh/stripe@20?target=deno';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
// New-style secret key, not the legacy service_role JWT -- see
// notify-admin/index.ts for why every function was migrated off it.
const SUPABASE_SERVICE_KEY = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')!)['secret'];
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!;
// Same var + trailing-slash handling as create-invoice-checkout.
const APP_URL = (Deno.env.get('APP_URL') || 'http://localhost:5173').replace(/\/+$/, '');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
// The v2 Accounts API this function calls doesn't exist under the older
// apiVersion pinned elsewhere in this project (2024-06-20, predates v2
// entirely) -- Stripe rejects the request outright rather than silently
// downgrading. This is the version Stripe's own current v2 account-creation
// docs example uses.
const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2026-07-29.dahlia' });

// Called by a signed-in musician from MyProfile to set up (or resume
// setting up) Stripe payouts. Creates their Connect account on first call,
// reuses it on every call after -- either way returns a fresh Account Link
// URL to redirect the browser to (links are single-use/short-lived, so a
// new one is minted per call rather than cached).
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

    // Same pattern as log-session -- identify the caller from their own
    // JWT rather than trusting a profile id in the body. A musician can
    // only ever set up payouts for themselves.
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

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('id, full_name, stripe_connect_account_id')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      return new Response(JSON.stringify({ error: 'Profile not found' }), {
        status: 404,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    let accountId = profile.stripe_connect_account_id;

    if (!accountId) {
      // Recipient-only account -- musicians receive transfers, they never
      // process a payment themselves, so no merchant/card_payments
      // configuration is requested (unnecessary and it slows onboarding
      // down). See connect-recommend-plan.md section A.
      const account = await stripe.v2.core.accounts.create({
        contact_email: user.email,
        display_name: profile.full_name || undefined,
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
            // Express dashboard requires the platform to own both fees and
            // losses -- a hard API constraint, not a preference. See
            // connect-recommend-plan.md section A/K.
            fees_collector: 'application',
            losses_collector: 'application',
          },
        },
      });

      accountId = account.id;

      const { error: updateError } = await admin
        .from('profiles')
        .update({ stripe_connect_account_id: accountId, stripe_connect_status: 'pending' })
        .eq('id', user.id);
      if (updateError) throw updateError;
    }

    // Account Links (hosted redirect), not embedded components -- Stripe's
    // embedded onboarding currently fails with "An error occurred while
    // authenticating your account" on newer Sandbox-mode accounts (a known,
    // open Stripe-side bug in the Connect.js popup-auth step, not something
    // fixable here; see connect-recommend-plan.md). Account Links is the
    // older, plainer API: no popup, no @stripe/connect-js dependency, just
    // a server-generated URL to redirect to and back from.
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      type: 'account_onboarding',
      refresh_url: `${APP_URL}/?stripe_connect=1`,
      return_url: `${APP_URL}/?stripe_connect=1`,
    });

    return new Response(JSON.stringify({ url: accountLink.url }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('create-connect-account error:', err);
    // Only a genuine Stripe error's message (written for end users) is
    // safe to show -- this catch also sees a raw Postgres error from the
    // `if (updateError) throw updateError` above, which can leak column/
    // constraint names and was never meant for client eyes.
    const message = err instanceof Stripe.errors.StripeError ? err.message : 'Something went wrong. Please try again.';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});

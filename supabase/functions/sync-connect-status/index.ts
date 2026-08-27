import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@20?target=deno';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
// New-style secret key, not the legacy service_role JWT -- see
// notify-admin/index.ts for why every function was migrated off it.
const SUPABASE_SERVICE_KEY = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')!)['secret'];
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2026-07-29.dahlia' });

// Called by ConnectPayoutSetup on mount. The stripe-connect-webhook
// (account.updated) is the primary way stripe_connect_status stays current,
// but webhooks can be missed, delayed, or -- as happened testing this --
// simply not registered yet at the moment an account first goes active.
// This gives the payouts page its own belt-and-braces check against
// Stripe directly, using the exact same v2 read the webhook does, so a
// stuck "pending" self-heals the next time the musician looks at the page
// instead of needing a webhook redelivery or manual DB fix.
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
      .select('stripe_connect_account_id')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      return new Response(JSON.stringify({ error: 'Profile not found' }), {
        status: 404,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    if (!profile.stripe_connect_account_id) {
      return new Response(JSON.stringify({ status: null }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const account = await stripe.v2.core.accounts.retrieve(profile.stripe_connect_account_id, {
      include: ['configuration.recipient'],
    });
    const status =
      account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status || 'pending';

    const { error: updateError } = await admin
      .from('profiles')
      .update({ stripe_connect_status: status })
      .eq('id', user.id);
    if (updateError) throw updateError;

    return new Response(JSON.stringify({ status }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('sync-connect-status error:', err);
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

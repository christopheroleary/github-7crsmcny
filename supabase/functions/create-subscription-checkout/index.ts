import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@17?target=deno';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!;
const APP_URL = (Deno.env.get('APP_URL') || 'http://localhost:5173').replace(/\/+$/, '');

// Not a secret -- Price IDs are meant to be used client-side in Stripe's own
// docs/examples, so this doesn't need to be an Edge Function secret.
const PRO_PRICE_ID = 'price_1U4UhjPUQIZwpLNOlutQU49J';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

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
      .select('full_name, stripe_customer_id, subscription_tier')
      .eq('id', user.id)
      .single();
    if (profileError || !profile) {
      return new Response(JSON.stringify({ error: 'Profile not found' }), {
        status: 404,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    if (profile.subscription_tier === 'pro') {
      return new Response(JSON.stringify({ error: 'Already on Pro' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    let customerId = profile.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: profile.full_name || undefined,
        metadata: { profile_id: user.id },
      });
      customerId = customer.id;
      await admin.from('profiles').update({ stripe_customer_id: customerId }).eq('id', user.id);
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      // Same Managed Payments opt-out as create-invoice-checkout -- this
      // account requires a Stripe product tax code on every line item
      // unless a session explicitly disables it, and the Pro price wasn't
      // created with one.
      // @ts-ignore -- not yet in this pinned SDK version's TS types
      managed_payments: { enabled: false },
      line_items: [{ price: PRO_PRICE_ID, quantity: 1 }],
      // Metadata on the session itself is only visible to checkout.session.*
      // events -- copying it onto subscription_data.metadata means it's also
      // on the subscription object the customer.subscription.* events carry,
      // so the webhook can update the right profile without a customer_id
      // round-trip either way.
      subscription_data: { metadata: { profile_id: user.id } },
      metadata: { profile_id: user.id },
      success_url: `${APP_URL}/?pro=1`,
      cancel_url: `${APP_URL}/?pro=0`,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('create-subscription-checkout error:', err);
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});

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

// Band-level counterpart to sync-connect-status. Called by
// BandConnectPayoutSetup on mount as a belt-and-braces check against Stripe
// directly, for the same reason the profile-level version exists: the
// account.updated webhook is the primary way stripe_connect_status stays
// current, but can be missed or delayed.
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
      .select('stripe_connect_account_id')
      .eq('id', band_id)
      .single();

    if (bandError || !band) {
      return new Response(JSON.stringify({ error: 'Band not found' }), {
        status: 404,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    if (!band.stripe_connect_account_id) {
      return new Response(JSON.stringify({ status: null }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const account = await stripe.v2.core.accounts.retrieve(band.stripe_connect_account_id, {
      include: ['configuration.recipient'],
    });
    const status =
      account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status || 'pending';

    const { error: updateError } = await admin
      .from('bands')
      .update({ stripe_connect_status: status })
      .eq('id', band_id);
    if (updateError) throw updateError;

    return new Response(JSON.stringify({ status }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('sync-band-connect-status error:', err);
    const message = err instanceof Stripe.errors.StripeError ? err.message : 'Something went wrong. Please try again.';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@17?target=deno';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

// Called from MusicianClaimsAdmin.jsx's "Pay via Stripe" action -- the
// automated alternative to the existing manual "Mark paid" button.
//
// Authorization isn't reimplemented here: the claim is first read back
// through the CALLER's own JWT-scoped client, which is subject to the
// existing claims_select RLS policy (admin, or band-leader of that gig's
// band). If that read returns nothing, the caller wasn't authorized (or
// the claim doesn't exist) and this stops immediately -- service-role is
// only used afterwards, once authorization is already established.
//
// The claim only flips to 'paid' after the Stripe transfer actually
// succeeds, never before -- the opposite order would risk marking
// something paid when no money had actually moved.
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

    const { claim_id } = await req.json();
    if (!claim_id) {
      return new Response(JSON.stringify({ error: 'Invalid request' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: claim, error: claimError } = await callerClient
      .from('musician_claims')
      .select('id, profile_id, gig_id, status')
      .eq('id', claim_id)
      .single();

    if (claimError || !claim) {
      return new Response(JSON.stringify({ error: 'Claim not found, or you are not authorized to pay it' }), {
        status: 404,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    if (claim.status !== 'approved') {
      return new Response(JSON.stringify({ error: 'Only an approved claim can be paid' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('stripe_connect_account_id, stripe_connect_status')
      .eq('id', claim.profile_id)
      .single();

    if (profileError || !profile?.stripe_connect_account_id || profile.stripe_connect_status !== 'active') {
      return new Response(JSON.stringify({ error: 'This musician has not finished setting up Stripe payouts yet' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const { data: items, error: itemsError } = await admin
      .from('musician_claim_items')
      .select('amount_pence')
      .eq('claim_id', claim_id);
    if (itemsError) throw itemsError;

    const totalPence = (items || []).reduce((sum: number, i: { amount_pence: number }) => sum + i.amount_pence, 0);
    if (totalPence <= 0) {
      return new Response(JSON.stringify({ error: 'Claim has no payable items' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const transfer = await stripe.transfers.create({
      amount: totalPence,
      currency: 'gbp',
      destination: profile.stripe_connect_account_id,
      metadata: { claim_id, gig_id: claim.gig_id },
    });

    const { error: updateError } = await admin
      .from('musician_claims')
      .update({ status: 'paid', stripe_transfer_id: transfer.id })
      .eq('id', claim_id);
    if (updateError) throw updateError;

    return new Response(JSON.stringify({ ok: true, transfer_id: transfer.id, amount_pence: totalPence }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('create-connect-transfer error:', err);
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});

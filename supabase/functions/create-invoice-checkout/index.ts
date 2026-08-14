import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@17?target=deno';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!;
// Where to send the client back to after paying/cancelling -- the deployed
// app origin in production, falls back to the local dev server.
const APP_URL = Deno.env.get('APP_URL') || 'http://localhost:5173';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Called from the public, unauthenticated invoice page (no Supabase login
// at all) -- service-role client because there's no user session to act as,
// same trust model get_invoice_by_token already uses: the share_token
// itself is the only authorization.
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const { share_token, amount_pence } = await req.json();

    if (!share_token || !Number.isInteger(amount_pence) || amount_pence <= 0) {
      return new Response(JSON.stringify({ error: 'Invalid request' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const { data: invoice, error: invoiceError } = await admin
      .from('invoices')
      .select('id, invoice_items(unit_amount_pence, quantity), invoice_payments(amount_pence)')
      .eq('share_token', share_token)
      .single();

    if (invoiceError || !invoice) {
      return new Response(JSON.stringify({ error: 'Invoice not found' }), {
        status: 404,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const totalDue = (invoice.invoice_items || []).reduce(
      (sum: number, i: { unit_amount_pence: number; quantity: number }) => sum + i.unit_amount_pence * i.quantity,
      0
    );
    const totalPaid = (invoice.invoice_payments || []).reduce(
      (sum: number, p: { amount_pence: number }) => sum + p.amount_pence,
      0
    );
    const balance = totalDue - totalPaid;

    // Never trust the client-sent amount as the truth -- clamp it against
    // what's actually still owed, computed here from the same rows the
    // ledger itself is built from, not whatever the browser happened to send.
    if (balance <= 0 || amount_pence > balance) {
      return new Response(JSON.stringify({ error: 'Amount exceeds remaining balance' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'gbp',
          unit_amount: amount_pence,
          product_data: { name: 'Invoice payment' },
        },
        quantity: 1,
      }],
      // Read back by the webhook to know which invoice this session was for.
      metadata: { invoice_id: invoice.id },
      success_url: `${APP_URL}/invoice/${share_token}?paid=1`,
      cancel_url: `${APP_URL}/invoice/${share_token}`,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('create-invoice-checkout error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});

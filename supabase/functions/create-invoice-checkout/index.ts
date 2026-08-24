import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@17?target=deno';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!;
// Where to send the client back to after paying/cancelling -- the deployed
// app origin in production, falls back to the local dev server. Trailing
// slash stripped so `${APP_URL}/invoice/...` below can't end up as a
// double slash depending on how the secret happened to be entered --
// Cloudflare Pages' SPA fallback doesn't match that route and it silently
// dumps the user on the sign-in page after a real, successful payment.
const APP_URL = (Deno.env.get('APP_URL') || 'http://localhost:5173').replace(/\/+$/, '');

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
      .select('id, share_token_expires_at, share_token_revoked_at, gigs(band_id), invoice_items(unit_amount_pence, quantity), invoice_payments(amount_pence)')
      .eq('share_token', share_token)
      .single();

    if (invoiceError || !invoice) {
      // A real DB/auth error was previously indistinguishable from a
      // genuinely bad token -- both returned the same generic 404, which
      // made a misconfigured service-role key look identical to a client
      // just guessing at URLs. Logging the real cause costs nothing and
      // saves the next debugging session.
      if (invoiceError) console.error('create-invoice-checkout invoice lookup failed:', JSON.stringify(invoiceError));
      return new Response(JSON.stringify({ error: 'Invoice not found' }), {
        status: 404,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // This runs on the service-role client, so RLS and the liveness check
    // baked into get_invoice_by_token are both bypassed here -- an expired
    // or revoked link would otherwise still be able to open a Checkout
    // session even though the invoice page itself refuses to load. Mirrors
    // public.share_token_is_live(). Same generic 404 as a bad token, so
    // this cannot be used to probe whether a token once existed.
    const revoked = invoice.share_token_revoked_at !== null;
    const expired =
      invoice.share_token_expires_at !== null &&
      new Date(invoice.share_token_expires_at) <= new Date();
    if (revoked || expired) {
      return new Response(JSON.stringify({ error: 'Invoice not found' }), {
        status: 404,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Mirrors get_invoice_by_token's stripe_payments_enabled logic exactly --
    // that RPC is what the public page uses to decide whether to even show
    // a "Pay now" button, but this endpoint is reachable directly, so it
    // needs its own copy of the same rule rather than trusting the client
    // didn't just skip the UI check.
    const bandId = (invoice.gigs as { band_id: string } | null)?.band_id;
    if (bandId) {
      const { data: leaders } = await admin
        .from('band_leaders')
        .select('profiles(role, subscription_tier)')
        .eq('band_id', bandId);
      if (leaders && leaders.length > 0) {
        const enabled = leaders.some((l) => {
          const p = l.profiles as unknown as { role: string; subscription_tier: string } | null;
          return p?.role === 'admin' || p?.subscription_tier === 'pro';
        });
        if (!enabled) {
          return new Response(JSON.stringify({ error: 'Card payments are not set up for this band yet.' }), {
            status: 403,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          });
        }
      }
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

    // The frontend already blocks this, but this endpoint is reachable
    // directly -- checking here too means a bypassed request gets this
    // exact explanation instead of Stripe's less friendly rejection text.
    if (amount_pence < 30) {
      return new Response(JSON.stringify({ error: 'Card payments must be at least £0.30.' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      // This account has Managed Payments on by default, which requires a
      // Stripe product tax code on every line item unless explicitly turned
      // off. The app already computes its own VAT (bands.vat_rate) and the
      // invoice amount is already final -- Stripe Tax would be redundant
      // and risks double-taxing, so this session opts out rather than
      // wiring up product tax codes for a calculation we don't need.
      // @ts-ignore -- not yet in this pinned SDK version's TS types
      managed_payments: { enabled: false },
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
    // err.message (e.g. Stripe's "amount_too_small" rejection text) reads
    // as a real explanation; String(err) prefixes the error class name,
    // which is engineer-speak nobody paying an invoice needs to see.
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});

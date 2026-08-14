import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@17?target=deno';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!;
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

Deno.serve(async (req) => {
  // Stripe signs the RAW request body -- it has to be read as text before
  // anything parses it as JSON, or the signature check fails even for a
  // genuine event from Stripe.
  const rawBody = await req.text();
  const signature = req.headers.get('Stripe-Signature');

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature ?? '', STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('stripe-webhook signature verification failed:', err);
    return new Response('Invalid signature', { status: 400 });
  }

  try {
    // Stripe explicitly does not guarantee exactly-once delivery -- record
    // the event id before acting on it, and treat a duplicate id as an
    // already-handled no-op rather than reprocessing it. Belt-and-braces
    // alongside invoice_payments.stripe_payment_intent_id's own unique
    // constraint, since a future event type could touch more than one row.
    const { error: dupeError } = await admin.from('stripe_webhook_events').insert({ id: event.id });
    if (dupeError) {
      if ((dupeError as { code?: string }).code === '23505') {
        return new Response(JSON.stringify({ ok: true, duplicate: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw dupeError;
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const invoiceId = session.metadata?.invoice_id;

      if (invoiceId && session.payment_status === 'paid' && session.amount_total) {
        const paymentIntentId = typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id ?? null;

        // Same RPC the admin's manual "Record payment" button in
        // GigInvoice.jsx calls -- one place decides when an invoice flips
        // to paid, whether the payment came in by card or bank transfer.
        const { error: rpcError } = await admin.rpc('record_invoice_payment', {
          p_invoice_id: invoiceId,
          p_amount_pence: session.amount_total,
          p_paid_date: new Date().toISOString().slice(0, 10),
          p_note: 'Paid online by card',
          p_stripe_payment_intent_id: paymentIntentId,
        });
        if (rpcError) throw rpcError;
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('stripe-webhook error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

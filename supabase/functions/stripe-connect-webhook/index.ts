import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@20?target=deno';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
// New-style secret key, not the legacy service_role JWT -- see
// notify-admin/index.ts for why every function was migrated off it.
const SUPABASE_SERVICE_KEY = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')!)['secret'];
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!;
// Separate secret from STRIPE_WEBHOOK_SECRET (the invoice-payments webhook)
// -- this is a different registered endpoint in Stripe with its own signing
// key, not a second use of the same one.
const STRIPE_CONNECT_WEBHOOK_SECRET = Deno.env.get('STRIPE_CONNECT_WEBHOOK_SECRET')!;

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2026-07-29.dahlia' });

Deno.serve(async (req) => {
  const rawBody = await req.text();
  const signature = req.headers.get('Stripe-Signature');

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature ?? '', STRIPE_CONNECT_WEBHOOK_SECRET);
  } catch (err) {
    console.error('stripe-connect-webhook signature verification failed:', err);
    return new Response('Invalid signature', { status: 400 });
  }

  try {
    const { error: dupeError } = await admin.from('stripe_webhook_events').insert({ id: event.id });
    if (dupeError) {
      if ((dupeError as { code?: string }).code === '23505') {
        return new Response(JSON.stringify({ ok: true, duplicate: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw dupeError;
    }

    // Same failure-resilience as stripe-webhook: if processing throws, the
    // event id gets un-recorded so a genuine Stripe retry can redo the
    // work instead of being silently swallowed as "already handled".
    try {
    if (event.type === 'account.updated') {
      // account.updated is a v1-shaped event regardless of whether the
      // account was created via the v1 or v2 API, and v1's capability
      // fields don't line up with the v2 configuration.recipient shape
      // this app creates accounts with -- rather than parse the v1 payload,
      // treat the event purely as a "something changed, go check" signal
      // and re-fetch the account through the same v2 API/shape
      // create-connect-account already uses, so there's exactly one place
      // that understands what "active" means for these accounts.
      const accountId = (event.data.object as { id: string }).id;

      const account = await stripe.v2.core.accounts.retrieve(accountId, {
        include: ['configuration.recipient'],
      });

      const transferStatus =
        account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status;
      // Whatever Stripe's status string is (active / pending / restricted /
      // etc) gets stored as-is -- the UI already falls back to a generic
      // "still in progress" message for anything it doesn't specifically
      // recognise, so this doesn't need to enumerate every possible value.
      const newStatus = transferStatus || 'pending';

      // An account id only ever matches one of these two tables -- a given
      // Connect account is created either as a musician's payout account
      // (create-connect-account) or a band's (create-band-connect-account),
      // never both -- so trying both updates unconditionally is unambiguous
      // and avoids needing to know here which kind of account this is.
      const [{ error: profileUpdateError }, { error: bandUpdateError }] = await Promise.all([
        admin.from('profiles').update({ stripe_connect_status: newStatus }).eq('stripe_connect_account_id', accountId),
        admin.from('bands').update({ stripe_connect_status: newStatus }).eq('stripe_connect_account_id', accountId),
      ]);
      if (profileUpdateError) throw profileUpdateError;
      if (bandUpdateError) throw bandUpdateError;
    }
    } catch (processingErr) {
      await admin.from('stripe_webhook_events').delete().eq('id', event.id);
      throw processingErr;
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('stripe-connect-webhook error:', err);
    // Stripe just needs a non-2xx to retry the delivery -- it doesn't
    // read the body, and this endpoint is public, so the real error
    // stays in the function logs rather than the response.
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

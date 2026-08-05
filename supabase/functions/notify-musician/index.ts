import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_EMAIL = (Deno.env.get('VAPID_EMAIL') || 'admin@gigmanager.app').replace(/^mailto:/i, '');

webpush.setVapidDetails('mailto:' + VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// amount_pence used to live directly on musician_claims; since itemising
// claims (fee/travel/etc. as separate lines) it lives on
// musician_claim_items instead, so this needs a follow-up query to sum the
// total rather than reading it straight off the webhook record.
async function claimTotalLabel(claimId: string): Promise<string> {
  const { data: items } = await supabase
    .from('musician_claim_items')
    .select('amount_pence')
    .eq('claim_id', claimId);
  const totalPence = (items || []).reduce((sum, r) => sum + r.amount_pence, 0);
  return '£' + (totalPence / 100).toFixed(2);
}

async function getSubscriptions(profileId: string) {
  const { data } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth_key')
    .eq('profile_id', profileId);
  return data || [];
}

async function notifyMusician(profileId: string, payload: {
  title: string;
  body: string;
  tag: string;
  url?: string;
  gig_id?: string;
  section?: string;
}) {
  // Save to in-app notification bell
  await supabase.from('notifications').insert({
    profile_id: profileId,
    title: payload.title,
    body: payload.body,
    url: payload.url || '/gigs',
    gig_id: payload.gig_id || null,
    section: payload.section || null,
    read: false,
  });

  // Send push notification to all their subscribed devices
  const subscriptions = await getSubscriptions(profileId);
  const stale: string[] = [];

  const results = await Promise.allSettled(
    subscriptions.map(async (sub: any) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth_key },
          },
          JSON.stringify({
            title: payload.title,
            body: payload.body,
            tag: payload.tag,
            url: payload.url || '/gigs',
          })
        );
        return { endpoint: sub.endpoint, ok: true };
      } catch (err: any) {
        if (err.statusCode === 410) stale.push(sub.endpoint);
        console.error(
          'push send failed',
          JSON.stringify({
            endpoint: sub.endpoint.slice(0, 60),
            statusCode: err.statusCode,
            message: err.message,
            body: err.body,
          })
        );
        return { endpoint: sub.endpoint, ok: false, statusCode: err.statusCode, message: err.message, body: err.body };
      }
    })
  );

  if (stale.length > 0) {
    await supabase.from('push_subscriptions').delete().in('endpoint', stale);
  }

  return results.map((r) => (r.status === 'fulfilled' ? r.value : { ok: false, error: String(r.reason) }));
}

Deno.serve(async (req) => {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid or empty JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { type, table, record, old_record } = body;

  try {
    let pushResults: any[] = [];

    // ── Musician added to gig roster ────────────────────────────────────────
    if (table === 'gig_lineup' && type === 'INSERT') {
      // Only notify real profiles, not deps/placeholders
      if (!record.profile_id) {
        return new Response(JSON.stringify({ ok: true, skipped: 'placeholder' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const { data: gig } = await supabase
        .from('gigs')
        .select('gig_date, venues(name), bands(name)')
        .eq('id', record.gig_id)
        .single();

      const { data: instrument } = await supabase
        .from('instruments')
        .select('name')
        .eq('id', record.instrument_id)
        .single();

      const venue = (gig as any)?.venues?.name || 'a venue';
      const band = (gig as any)?.bands?.name || '';
      const date = (gig as any)?.gig_date || '';
      const inst = (instrument as any)?.name || '';

      const titleParts = ['You\'ve been added to a gig'];
      const bodyParts = ['You\'ve been booked'];
      if (inst) bodyParts.push('on ' + inst);
      if (band) bodyParts.push('with ' + band);
      bodyParts.push('at ' + venue);
      if (date) bodyParts.push('on ' + date);
      bodyParts.push('— please confirm your availability.');

      pushResults = await notifyMusician(record.profile_id, {
        title: titleParts.join(''),
        body: bodyParts.join(' '),
        tag: 'lineup-' + record.id,
        url: '/gigs',
        gig_id: record.gig_id,
        section: 'roster',
      });
    }

    // ── Invoice claim status changed ─────────────────────────────────────────
    if (table === 'musician_claims' && type === 'UPDATE') {
      const oldStatus = old_record?.status;
      const newStatus = record.status;

      // Only notify on meaningful status changes
      if (oldStatus === newStatus) {
        return new Response(JSON.stringify({ ok: true, skipped: 'no status change' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Only notify on approved or rejected
      if (newStatus !== 'approved' && newStatus !== 'rejected') {
        return new Response(JSON.stringify({ ok: true, skipped: 'status not actionable' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const { data: gig } = await supabase
        .from('gigs')
        .select('gig_date, venues(name)')
        .eq('id', record.gig_id)
        .single();

      const venue = (gig as any)?.venues?.name || 'a gig';
      const date = (gig as any)?.gig_date || '';
      const amount = await claimTotalLabel(record.id);

      const isApproved = newStatus === 'approved';
      const title = isApproved
        ? 'Your claim has been approved'
        : 'Your claim has been rejected';
      const body = isApproved
        ? 'Your ' + amount + ' claim for ' + venue + (date ? ' on ' + date : '') + ' has been approved.'
        : 'Your ' + amount + ' claim for ' + venue + (date ? ' on ' + date : '') + ' has been rejected.' + (record.notes ? ' Note: ' + record.notes : '');

      pushResults = await notifyMusician(record.profile_id, {
        title,
        body,
        tag: 'claim-' + record.id,
        url: '/gigs',
        gig_id: record.gig_id,
        section: 'claims',
      });
    }

    return new Response(JSON.stringify({ ok: true, pushResults }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('notify-musician error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

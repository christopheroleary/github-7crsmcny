import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_EMAIL = Deno.env.get('VAPID_EMAIL') || 'mailto:admin@gigmanager.app';

webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function getAdminSubscriptions() {
  const { data: admins } = await supabase
    .from('profiles')
    .select('id')
    .eq('role', 'admin');

  if (!admins?.length) return [];

  const adminIds = admins.map((a) => a.id);
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth_key')
    .in('profile_id', adminIds);

  return subs || [];
}

async function pushToAdmins(payload: { title: string; body: string; tag: string; url?: string }) {
  const subscriptions = await getAdminSubscriptions();
  const stale: string[] = [];

  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
          JSON.stringify(payload)
        );
      } catch (err: any) {
        if (err.statusCode === 410) stale.push(sub.endpoint);
      }
    })
  );

  // Clean up expired subscriptions
  if (stale.length > 0) {
    await supabase.from('push_subscriptions').delete().in('endpoint', stale);
  }
}

Deno.serve(async (req) => {
  const body = await req.json();

  // Supabase sends webhook payload with type and record
  const { type, table, record, old_record } = body;

  try {
    if (table === 'gig_lineup') {
      // Musician confirmed or changed confirmation status
      if (type === 'UPDATE' && record.confirmed !== old_record?.confirmed) {
        // Get musician name and gig/venue info
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', record.profile_id)
          .single();

        const { data: gig } = await supabase
          .from('gigs')
          .select('gig_date, venues(name)')
          .eq('id', record.gig_id)
          .single();

        const musicianName = profile?.full_name || 'A musician';
        const venueName = (gig as any)?.venues?.name || 'a gig';
        const gigDate = gig?.gig_date || '';
        const action = record.confirmed ? 'confirmed' : 'unconfirmed';

        await pushToAdmins({
          title: `${musicianName} ${action} for ${venueName}`,
          body: `${musicianName} has ${action} their place on the ${gigDate} gig at ${venueName}.`,
          tag: 'lineup-' + record.id,
          url: '/',
        });
      }
    }

    if (table === 'musician_claims') {
      if (type === 'INSERT') {
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', record.profile_id)
          .single();

        const { data: gig } = await supabase
          .from('gigs')
          .select('gig_date, venues(name)')
          .eq('id', record.gig_id)
          .single();

        const musicianName = profile?.full_name || 'A musician';
        const amount = '£' + (record.amount_pence / 100).toFixed(2);
        const venueName = (gig as any)?.venues?.name || 'a gig';

        await pushToAdmins({
          title: `New payment claim from ${musicianName}`,
          body: `${musicianName} submitted a ${amount} claim for ${venueName} — ${record.description}.`,
          tag: 'claim-' + record.id,
          url: '/',
        });
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('notify-admin error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_EMAIL = (Deno.env.get('VAPID_EMAIL') || 'admin@gigmanager.app').replace(/^mailto:/i, '');

webpush.setVapidDetails('mailto:' + VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function getAdminIds() {
  const { data: admins } = await supabase
    .from('profiles')
    .select('id')
    .eq('role', 'admin');
  return (admins || []).map((a) => a.id);
}

async function getSubscriptionsFor(profileIds: string[]) {
  if (!profileIds.length) return [];
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth_key')
    .in('profile_id', profileIds);
  return subs || [];
}

async function pushToAdmins(payload: { title: string; body: string; tag: string; url?: string; gig_id?: string }) {
  const adminIds = await getAdminIds();
  if (!adminIds.length) return;

  // Save an in-app notification for every admin
  await supabase.from('notifications').insert(
    adminIds.map((profileId) => ({
      profile_id: profileId,
      title: payload.title,
      body: payload.body,
      url: payload.url || '/',
      gig_id: payload.gig_id || null,
      read: false,
    }))
  );

  // Send push notification to all their subscribed devices
  const subscriptions = await getSubscriptionsFor(adminIds);
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
          gig_id: record.gig_id,
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
          gig_id: record.gig_id,
        });
      }

      // A rejected claim was amended and resubmitted — put it back on the admin's radar.
      if (type === 'UPDATE' && old_record?.status === 'rejected' && record.status === 'pending') {
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
          title: `${musicianName} resubmitted their claim`,
          body: `${musicianName} amended and resubmitted a ${amount} claim for ${venueName} — ${record.description}.`,
          tag: 'claim-' + record.id,
          url: '/',
          gig_id: record.gig_id,
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
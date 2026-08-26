import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
// New-style secret key, not the legacy service_role JWT -- see
// notify-admin/index.ts for why every function was migrated off it.
const SUPABASE_SERVICE_KEY = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')!)['secret'];
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_EMAIL = (Deno.env.get('VAPID_EMAIL') || 'admin@gigmanager.app').replace(/^mailto:/i, '');

webpush.setVapidDetails('mailto:' + VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Same recipient set as notify-admin's pushToAdmins -- every admin, plus
// whoever leads the specific band this gig belongs to.
async function getRecipientIds(bandId: string | null): Promise<string[]> {
  const { data: admins } = await supabase.from('profiles').select('id').eq('role', 'admin');
  const adminIds = (admins || []).map((a) => a.id);
  if (!bandId) return adminIds;

  const { data: leaders } = await supabase.from('band_leaders').select('profile_id').eq('band_id', bandId);
  const leaderIds = (leaders || []).map((l) => l.profile_id);
  return Array.from(new Set([...adminIds, ...leaderIds]));
}

async function getSubscriptionsFor(profileIds: string[]) {
  if (!profileIds.length) return [];
  const { data } = await supabase.from('push_subscriptions').select('endpoint, p256dh, auth_key').in('profile_id', profileIds);
  return data || [];
}

async function pushTo(recipientIds: string[], payload: { title: string; body: string; url: string; gig_id: string; section: string }) {
  if (!recipientIds.length) return;

  await supabase.from('notifications').insert(
    recipientIds.map((profile_id) => ({
      profile_id,
      title: payload.title,
      body: payload.body,
      url: payload.url,
      gig_id: payload.gig_id,
      section: payload.section,
      read: false,
    }))
  );

  const subscriptions = await getSubscriptionsFor(recipientIds);
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
  if (stale.length > 0) {
    await supabase.from('push_subscriptions').delete().in('endpoint', stale);
  }
}

function formatGigDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

// Runs every few hours (not tied to a specific local wall-clock moment, so
// unlike gig-day-reminder there's no isWindowNow() gate needed) -- finds
// every real-account roster row that's sat unconfirmed for 2+ days on a
// still-upcoming, non-cancelled gig, nudges the admins/band-leader who can
// do something about it, and marks admin_notified_at so it's only ever
// flagged once per invite (resend_gig_invite, called from the roster UI,
// clears that flag by restarting created_at -- so a resend that itself goes
// unconfirmed for another 2 days gets flagged again, same as the first time).
Deno.serve(async (_req) => {
  try {
    const cutoff = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const today = new Date().toISOString().slice(0, 10);

    const { data: rows, error } = await supabase
      .from('gig_lineup')
      .select('id, profile_id, gig_id, gigs!inner(id, gig_date, status, band_id, venues(name)), profiles(full_name)')
      .not('profile_id', 'is', null)
      .eq('confirmed', false)
      .is('admin_notified_at', null)
      .lte('created_at', cutoff)
      .gte('gigs.gig_date', today)
      .neq('gigs.status', 'cancelled');

    if (error) throw error;
    if (!rows || rows.length === 0) {
      return new Response(JSON.stringify({ ok: true, reminded: 0 }), { headers: { 'Content-Type': 'application/json' } });
    }

    let reminded = 0;
    for (const row of rows as any[]) {
      const gig = row.gigs;
      const venueName = gig?.venues?.name || 'a gig';
      const musicianName = row.profiles?.full_name || 'A musician';
      const recipientIds = await getRecipientIds(gig?.band_id ?? null);

      await pushTo(recipientIds, {
        title: 'Still unconfirmed: ' + musicianName,
        body: musicianName + " hasn't confirmed " + venueName + ' on ' + formatGigDate(gig.gig_date) + " (added 2+ days ago) — resend the invite from the gig's roster.",
        url: '/gigs',
        gig_id: row.gig_id,
        section: 'roster',
      });

      await supabase.from('gig_lineup').update({ admin_notified_at: new Date().toISOString() }).eq('id', row.id);
      reminded += 1;
    }

    return new Response(JSON.stringify({ ok: true, reminded }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('unconfirmed-roster-reminder error:', err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});

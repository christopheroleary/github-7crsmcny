import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
// New-style secret key, not the legacy service_role JWT -- see
// notify-admin/index.ts for why every function was migrated off it.
const SUPABASE_SERVICE_KEY = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')!)['secret'];
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_EMAIL = (Deno.env.get('VAPID_EMAIL') || 'admin@seeau.app').replace(/^mailto:/i, '');

webpush.setVapidDetails('mailto:' + VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// pg_cron fires this every 15 minutes across both UTC hours that "9:30am
// Europe/London" could ever fall on (08:30 during BST, 09:30 during GMT),
// and this checks the real local wall-clock time rather than trusting the
// cron's fixed UTC grid -- so the reminder actually lands at 9:30am UK
// time year-round without the cron schedule needing to change for DST.
function isReminderWindowNow(): boolean {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value);
  return hour === 9 && minute >= 30 && minute < 45;
}

function todayInLondon(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
}

function formatTime(t: string | null): string | null {
  return t ? t.slice(0, 5) : null;
}

async function getSubscriptions(profileIds: string[]) {
  if (!profileIds.length) return [];
  const { data } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth_key, profile_id')
    .in('profile_id', profileIds);
  return data || [];
}

// See notify-admin/index.ts's getUnreadCounts -- same reasoning: each
// recipient has their own unread total, so it's looked up once per batch
// and merged in per-device below rather than shared across the payload.
async function getUnreadCounts(profileIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!profileIds.length) return counts;
  const { data: rows } = await supabase
    .from('notifications')
    .select('profile_id')
    .in('profile_id', profileIds)
    .eq('read', false);
  for (const row of rows || []) {
    counts.set(row.profile_id, (counts.get(row.profile_id) || 0) + 1);
  }
  return counts;
}

async function notifyGigDay(profileIds: string[], payload: { title: string; body: string; tag: string; url: string; gig_id: string }) {
  if (!profileIds.length) return;

  await supabase.from('notifications').insert(
    profileIds.map((profile_id) => ({
      profile_id,
      title: payload.title,
      body: payload.body,
      url: payload.url,
      gig_id: payload.gig_id,
      read: false,
    }))
  );

  const subscriptions = await getSubscriptions(profileIds);
  const unreadCounts = await getUnreadCounts(profileIds);
  const stale: string[] = [];

  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
          JSON.stringify({
            title: payload.title,
            body: payload.body,
            tag: payload.tag,
            url: payload.url,
            unreadCount: unreadCounts.get(sub.profile_id) || 0,
          })
        );
        await supabase.rpc('record_push_success', { p_endpoint: sub.endpoint });
      } catch (err: any) {
        // See notify-musician/index.ts -- a 403 here means a VAPID key
        // mismatch, which is just as permanently dead as a 410.
        if (err.statusCode === 410 || err.statusCode === 403) {
          stale.push(sub.endpoint);
        } else {
          // See notify-musician/index.ts's matching branch -- surfaces a
          // subscription that's still there but not really getting
          // through, instead of silently doing nothing about it.
          await supabase.rpc('record_push_failure', {
            p_endpoint: sub.endpoint,
            p_reason: 'HTTP ' + (err.statusCode ?? '?') + ': ' + (err.message || 'unknown error'),
          });
        }
      }
    })
  );

  if (stale.length > 0) {
    await supabase.from('push_subscriptions').delete().in('endpoint', stale);
  }
}

Deno.serve(async (_req) => {
  try {
    if (!isReminderWindowNow()) {
      return new Response(JSON.stringify({ ok: true, skipped: 'not in reminder window' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const today = todayInLondon();

    // Only confirmed gigs -- an inquiry hasn't actually been booked yet, so
    // telling musicians "you're on today" for one would be actively wrong.
    const { data: gigs, error: gigsError } = await supabase
      .from('gigs')
      .select('id, load_in_time, start_time, venues(name), bands(name)')
      .eq('gig_date', today)
      .eq('status', 'confirmed');

    if (gigsError) throw gigsError;
    if (!gigs || gigs.length === 0) {
      return new Response(JSON.stringify({ ok: true, gigs: 0 }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Admins previously only heard about a gig day if they personally
    // happened to be on that gig's roster -- the common case, an admin who
    // isn't playing but still wants to know a gig is on today, got nothing.
    const { data: admins } = await supabase.from('profiles').select('id').eq('role', 'admin');
    const adminIds = (admins || []).map((a) => a.id);

    let remindedGigs = 0;
    let remindedMusicians = 0;
    let remindedAdmins = 0;

    for (const gig of gigs) {
      // Defends against double-sending if this ever runs twice for the same
      // gig -- a "Gig day" reminder for a given gig is only ever sent once.
      const { data: existing } = await supabase
        .from('notifications')
        .select('id')
        .eq('gig_id', gig.id)
        .ilike('title', 'Gig day:%')
        .limit(1);
      if (existing && existing.length > 0) continue;

      const { data: lineup } = await supabase
        .from('gig_lineup')
        .select('profile_id')
        .eq('gig_id', gig.id)
        .not('profile_id', 'is', null);

      const profileIds = Array.from(new Set((lineup || []).map((l) => l.profile_id).filter(Boolean))) as string[];

      const venueName = (gig as any).venues?.name || 'your gig';
      const bandName = (gig as any).bands?.name || null;
      const loadIn = formatTime(gig.load_in_time);
      const onStage = formatTime(gig.start_time);
      const timeBits = [loadIn && 'Load-in ' + loadIn, onStage && 'on stage ' + onStage].filter(Boolean).join(', ');

      if (profileIds.length > 0) {
        await notifyGigDay(profileIds, {
          title: 'Gig day: ' + venueName,
          body: (timeBits ? timeBits + '. ' : '') + "You're on today — tap for details.",
          tag: 'gig-day-' + gig.id,
          url: '/gigs',
          gig_id: gig.id,
        });
        remindedMusicians += profileIds.length;
      }

      // An admin who's also personally on this gig's roster already got the
      // musician-worded message above -- don't also send them this one.
      const adminOnlyIds = adminIds.filter((id) => !profileIds.includes(id));
      if (adminOnlyIds.length > 0) {
        await notifyGigDay(adminOnlyIds, {
          title: 'Gig day: ' + venueName,
          body: (timeBits ? timeBits + '. ' : '') + (bandName ? bandName + ' play' : 'A gig is on') + ' today — tap for details.',
          tag: 'gig-day-' + gig.id,
          url: '/gigs',
          gig_id: gig.id,
        });
        remindedAdmins += adminOnlyIds.length;
      }

      if (profileIds.length > 0 || adminOnlyIds.length > 0) remindedGigs += 1;
    }

    return new Response(JSON.stringify({ ok: true, gigs: gigs.length, remindedGigs, remindedMusicians, remindedAdmins }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('gig-day-reminder error:', err);
    // Cron-invoked -- nobody reads this response body, so keep the real
    // error (which can include raw Postgres details) in the logs only.
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

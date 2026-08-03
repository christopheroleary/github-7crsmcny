import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_EMAIL = (Deno.env.get('VAPID_EMAIL') || 'admin@gigmanager.app').replace(/^mailto:/i, '');

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
    .select('endpoint, p256dh, auth_key')
    .in('profile_id', profileIds);
  return data || [];
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
  const stale: string[] = [];

  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
          JSON.stringify({ title: payload.title, body: payload.body, tag: payload.tag, url: payload.url })
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

Deno.serve(async (_req) => {
  try {
    if (!isReminderWindowNow()) {
      return new Response(JSON.stringify({ ok: true, skipped: 'not in reminder window' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const today = todayInLondon();

    const { data: gigs, error: gigsError } = await supabase
      .from('gigs')
      .select('id, load_in_time, start_time, venues(name)')
      .eq('gig_date', today)
      .neq('status', 'cancelled');

    if (gigsError) throw gigsError;
    if (!gigs || gigs.length === 0) {
      return new Response(JSON.stringify({ ok: true, gigs: 0 }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let remindedGigs = 0;
    let remindedMusicians = 0;

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
      if (profileIds.length === 0) continue;

      const venueName = (gig as any).venues?.name || 'your gig';
      const loadIn = formatTime(gig.load_in_time);
      const onStage = formatTime(gig.start_time);
      const timeBits = [loadIn && 'Load-in ' + loadIn, onStage && 'on stage ' + onStage].filter(Boolean).join(', ');

      await notifyGigDay(profileIds, {
        title: 'Gig day: ' + venueName,
        body: (timeBits ? timeBits + '. ' : '') + "You're on today — tap for details.",
        tag: 'gig-day-' + gig.id,
        url: '/gigs',
        gig_id: gig.id,
      });

      remindedGigs += 1;
      remindedMusicians += profileIds.length;
    }

    return new Response(JSON.stringify({ ok: true, gigs: gigs.length, remindedGigs, remindedMusicians }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('gig-day-reminder error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

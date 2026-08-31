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

  // This recipient's current total unread count (including the row just
  // inserted above) -- carried in the push payload so the service worker
  // can set the home-screen icon badge to the true total, not just "one
  // more arrived" (see public/sw.js's push handler and useAppBadge.js's
  // notes on why this app has no other way to update it in the background).
  const { count: unreadCount } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('profile_id', profileId)
    .eq('read', false);

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
            unreadCount: unreadCount ?? 0,
          })
        );
        await supabase.rpc('record_push_success', { p_endpoint: sub.endpoint });
        return { endpoint: sub.endpoint, ok: true };
      } catch (err: any) {
        // 403 here means the push service rejected the VAPID JWT as not
        // matching this subscription's key -- permanently unrecoverable
        // for this subscription (it was created under a different
        // VAPID_PUBLIC_KEY than the one currently configured), so it's
        // pruned exactly like a 410 Gone rather than retried forever.
        if (err.statusCode === 410 || err.statusCode === 403) {
          stale.push(sub.endpoint);
        } else {
          // Anything else (timeout, 5xx from the push service, network
          // blip) used to just get logged and forgotten -- the row stayed
          // looking perfectly healthy with no visibility into it actually
          // failing. Recorded instead so the admin Activity tab can flag a
          // subscription that's technically still there but not really
          // getting through.
          await supabase.rpc('record_push_failure', {
            p_endpoint: sub.endpoint,
            p_reason: 'HTTP ' + (err.statusCode ?? '?') + ': ' + (err.message || 'unknown error'),
          });
        }
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

// Surfaces the outcome on the roster row itself (GigRoster.jsx reads this)
// instead of it being discarded once this fire-and-forget webhook returns.
// Distinguishes "never opted in" from "actually broken" since the fix an
// admin/leader needs differs -- one just needs nudging another way, the
// other might be worth flagging as a real bug.
async function recordInvitePushStatus(lineupId: string, pushResults: any[]) {
  const status = pushResults.length === 0
    ? 'not_subscribed'
    : pushResults.some((r: any) => r.ok)
      ? 'delivered'
      : 'failed';
  await supabase.from('gig_lineup').update({ invite_push_status: status }).eq('id', lineupId);
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
      await recordInvitePushStatus(record.id, pushResults);
    }

    // ── Gig invite manually resent ──────────────────────────────────────────
    // Not a real Postgres trigger op -- resend_gig_invite() fires this
    // itself (via net.http_post) after resetting the roster row's
    // created_at, so it gets the same bell+push treatment as a first-time
    // add rather than sitting bell-only like the direct-insert version did.
    if (table === 'gig_lineup' && type === 'RESEND') {
      if (!record.profile_id) {
        return new Response(JSON.stringify({ ok: true, skipped: 'placeholder' }), {
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

      pushResults = await notifyMusician(record.profile_id, {
        title: 'Reminder: please confirm your gig',
        body: venue + (date ? ' on ' + date : '') + ' — tap to confirm you can make it.',
        tag: 'lineup-resend-' + record.id,
        url: '/gigs',
        gig_id: record.gig_id,
        section: 'roster',
      });
      await recordInvitePushStatus(record.id, pushResults);
    }

    // ── New gig chat message ────────────────────────────────────────────────
    // Notifies everyone else on the gig's real-account roster (not the
    // sender, not placeholders/deps who have no login). Each recipient gets
    // their own bell row + push via notifyMusician, same as every other
    // event here -- previously this was a bell-only insert done straight in
    // the trigger, with no push at all.
    if (table === 'gig_messages' && type === 'INSERT') {
      const [{ data: gig }, { data: sender }, { data: lineup }] = await Promise.all([
        supabase.from('gigs').select('venues(name)').eq('id', record.gig_id).single(),
        record.sender_id
          ? supabase.from('profiles').select('full_name').eq('id', record.sender_id).single()
          : Promise.resolve({ data: null }),
        supabase.from('gig_lineup').select('profile_id').eq('gig_id', record.gig_id).not('profile_id', 'is', null),
      ]);

      const venue = (gig as any)?.venues?.name || 'the gig';
      const senderName = (sender as any)?.full_name || 'Someone';
      const recipientIds = Array.from(
        new Set((lineup || []).map((l: any) => l.profile_id))
      ).filter((id) => id !== record.sender_id) as string[];

      pushResults = (
        await Promise.all(
          recipientIds.map((profileId) =>
            notifyMusician(profileId, {
              title: senderName + ' messaged about ' + venue,
              body: record.body,
              tag: 'gig-message-' + record.id,
              url: '/gigs',
              gig_id: record.gig_id,
              section: 'chat',
            })
          )
        )
      ).flat();
    }

    // ── New song request from a gig's QR code ────────────────────────────────
    // Fires once per genuinely new request (a repeat tap for the same song
    // is an UPDATE via the request_count upsert, not an INSERT -- see
    // notify_song_request() -- so this never re-fires on duplicate taps).
    if (table === 'song_requests' && type === 'INSERT') {
      const [{ data: gig }, { data: song }, { data: lineup }] = await Promise.all([
        supabase.from('gigs').select('venues(name)').eq('id', record.gig_id).single(),
        record.song_id
          ? supabase.from('songs').select('title, artist').eq('id', record.song_id).single()
          : Promise.resolve({ data: null }),
        supabase.from('gig_lineup').select('profile_id').eq('gig_id', record.gig_id).not('profile_id', 'is', null),
      ]);

      const venue = (gig as any)?.venues?.name || 'the gig';
      const songLabel = (song as any)
        ? (song as any).title + ((song as any).artist ? ' — ' + (song as any).artist : '')
        : record.requested_text;
      const recipientIds = Array.from(
        new Set((lineup || []).map((l: any) => l.profile_id))
      ) as string[];

      pushResults = (
        await Promise.all(
          recipientIds.map((profileId) =>
            notifyMusician(profileId, {
              title: 'Song request at ' + venue,
              body: songLabel,
              tag: 'song-request-' + record.id,
              url: '/gigs',
              gig_id: record.gig_id,
              section: 'requests',
            })
          )
        )
      ).flat();
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
    // A DB webhook invocation -- nobody reads this response body, so keep
    // the real error (which can include raw Postgres details) in the
    // logs only.
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

// Despite the name, this doesn't only notify admins -- pushToAdmins() below
// sends to every admin PLUS the leader(s) of the specific band an event is
// scoped to (see getRecipientIds). Renaming the function/file was judged
// not worth the risk (the edge function slug is a live URL baked into a
// hardcoded string inside notify_admin_webhook(), called by four DB
// triggers), so this comment is the fix instead.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
// New-style secret key, not the legacy service_role JWT -- the trigger
// that calls this function used to authenticate with a literal copy of
// the service_role key hardcoded in a migration (a real leak, since fixed
// by moving it into Vault -- see 20260826160000_notify_admin_vault_secret.sql).
// Every Edge Function was migrated off the legacy key at the same time.
// SUPABASE_SECRET_KEYS is auto-injected by Supabase, a JSON dict keyed by
// name; "secret" is the key created for this project.
const SUPABASE_SERVICE_KEY = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')!)['secret'];
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

// Admins always get everything; band leaders additionally get anything
// scoped to a band they lead (passing bandId).
async function getRecipientIds(bandId?: string | null) {
  const adminIds = await getAdminIds();
  if (!bandId) return adminIds;

  const { data: leaders } = await supabase
    .from('band_leaders')
    .select('profile_id')
    .eq('band_id', bandId);
  const leaderIds = (leaders || []).map((l) => l.profile_id);

  return Array.from(new Set([...adminIds, ...leaderIds]));
}

function formatGigDate(dateStr: string): string {
  if (!dateStr) return '';
  // Parsed and formatted as UTC throughout -- gig_date is a plain date with
  // no time component, and letting it fall through the server's local
  // timezone risks shifting it a day either way right at midnight.
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// amount_pence/description used to live directly on musician_claims; since
// itemising claims (fee/travel/etc. as separate lines) they live on
// musician_claim_items instead, so building a notification needs this
// follow-up query rather than reading straight off the webhook record.
async function claimSummary(claimId: string): Promise<{ amountLabel: string; description: string }> {
  const { data: items } = await supabase
    .from('musician_claim_items')
    .select('description, amount_pence')
    .eq('claim_id', claimId)
    .order('sort_order');
  const rows = items || [];
  const totalPence = rows.reduce((sum, r) => sum + r.amount_pence, 0);
  const amountLabel = '£' + (totalPence / 100).toFixed(2);
  const description = rows.length === 0
    ? ''
    : rows.length === 1
      ? rows[0].description
      : rows[0].description + ' + ' + (rows.length - 1) + ' more';
  return { amountLabel, description };
}

async function getSubscriptionsFor(profileIds: string[]) {
  if (!profileIds.length) return [];
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth_key')
    .in('profile_id', profileIds);
  return subs || [];
}

async function pushToAdmins(
  payload: { title: string; body: string; tag: string; url?: string; gig_id?: string; section?: string },
  bandId?: string | null,
  // The person whose own action triggered this (they confirmed, submitted a
  // claim, etc.) -- a band leader is also a recipient of their own band's
  // notifications, so without this they'd get pinged about their own action.
  excludeProfileId?: string | null
) {
  const recipientIds = (await getRecipientIds(bandId)).filter((id) => id !== excludeProfileId);
  if (!recipientIds.length) return;

  // Save an in-app notification for every recipient
  await supabase.from('notifications').insert(
    recipientIds.map((profileId) => ({
      profile_id: profileId,
      title: payload.title,
      body: payload.body,
      url: payload.url || '/gigs',
      gig_id: payload.gig_id || null,
      section: payload.section || null,
      read: false,
    }))
  );

  // Send push notification to all their subscribed devices
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
        // See notify-musician/index.ts -- a 403 here means a VAPID key
        // mismatch, which is just as permanently dead as a 410.
        if (err.statusCode === 410 || err.statusCode === 403) stale.push(sub.endpoint);
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
        // A dep/session musician has no profile_id at all -- their name
        // lives on placeholder_musicians via placeholder_id instead, so
        // both need checking or a dep confirming always fell back to the
        // generic "A musician" while a full member's name showed fine.
        const [{ data: profile }, { data: placeholder }, { data: instrument }, { data: gig }] = await Promise.all([
          record.profile_id
            ? supabase.from('profiles').select('full_name').eq('id', record.profile_id).single()
            : Promise.resolve({ data: null }),
          record.placeholder_id
            ? supabase.from('placeholder_musicians').select('name').eq('id', record.placeholder_id).single()
            : Promise.resolve({ data: null }),
          record.instrument_id
            ? supabase.from('instruments').select('name').eq('id', record.instrument_id).single()
            : Promise.resolve({ data: null }),
          supabase.from('gigs').select('gig_date, band_id, venues(name), bands(name)').eq('id', record.gig_id).single(),
        ]);

        const musicianName = profile?.full_name || placeholder?.name || 'A musician';
        const venueName = (gig as any)?.venues?.name || 'a gig';
        const bandName = (gig as any)?.bands?.name || '';
        const instrumentName = (instrument as any)?.name || '';
        const action = record.confirmed ? 'confirmed' : 'unconfirmed';

        await pushToAdmins({
          title: `${musicianName} ${action} for ${venueName}`,
          body: [instrumentName, formatGigDate(gig?.gig_date), bandName].filter(Boolean).join(' · ')
            || `${musicianName} has ${action} their place at ${venueName}.`,
          tag: 'lineup-' + record.id,
          url: '/gigs',
          gig_id: record.gig_id,
          section: 'roster',
        }, gig?.band_id, record.profile_id);
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
          .select('gig_date, band_id, venues(name)')
          .eq('id', record.gig_id)
          .single();

        const musicianName = profile?.full_name || 'A musician';
        const { amountLabel, description } = await claimSummary(record.id);
        const venueName = (gig as any)?.venues?.name || 'a gig';

        await pushToAdmins({
          title: `New payment claim from ${musicianName}`,
          body: `${musicianName} submitted a ${amountLabel} claim for ${venueName}` + (description ? ` — ${description}.` : '.'),
          tag: 'claim-' + record.id,
          url: '/gigs',
          gig_id: record.gig_id,
          section: 'claims',
        }, gig?.band_id, record.profile_id);
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
          .select('gig_date, band_id, venues(name)')
          .eq('id', record.gig_id)
          .single();

        const musicianName = profile?.full_name || 'A musician';
        const { amountLabel, description } = await claimSummary(record.id);
        const venueName = (gig as any)?.venues?.name || 'a gig';

        await pushToAdmins({
          title: `${musicianName} resubmitted their claim`,
          body: `${musicianName} amended and resubmitted a ${amountLabel} claim for ${venueName}` + (description ? ` — ${description}.` : '.'),
          tag: 'claim-' + record.id,
          url: '/gigs',
          gig_id: record.gig_id,
          section: 'claims',
        }, gig?.band_id, record.profile_id);
      }
    }

    if (table === 'enquiries' && type === 'INSERT') {
      const eventBits = [record.event_type, record.event_date].filter(Boolean).join(' · ');
      const budget = record.estimated_budget ? '£' + record.estimated_budget : '';

      await pushToAdmins({
        title: `New enquiry from ${record.client_name}`,
        body: [eventBits, budget].filter(Boolean).join(' — ') || 'View details in Enquiries.',
        tag: 'enquiry-' + record.id,
        url: '/enquiries',
      });
    }

    if (table === 'profiles' && type === 'INSERT') {
      await pushToAdmins({
        title: 'New user signed up',
        body: `${record.full_name || 'Someone'} just created an account.`,
        tag: 'signup-' + record.id,
        url: '/musicians',
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('notify-admin error:', err);
    // A DB webhook invocation -- nobody reads this response body, so keep
    // the real error (which can include raw Postgres details) in the
    // logs only.
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
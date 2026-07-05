import webpush from 'npm:web-push@3.6.7';

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_EMAIL = Deno.env.get('VAPID_EMAIL') || 'mailto:admin@gigmanager.app';

webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  url?: string;
  requireInteraction?: boolean;
}

export interface PushSubscription {
  endpoint: string;
  p256dh: string;
  auth_key: string;
}

export async function sendPush(subscription: PushSubscription, payload: PushPayload) {
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth_key,
        },
      },
      JSON.stringify(payload)
    );
    return { success: true };
  } catch (err: any) {
    // 410 Gone means the subscription is expired — clean it up
    return { success: false, expired: err.statusCode === 410, error: err.message };
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const { subscription, payload } = await req.json();
  if (!subscription || !payload) {
    return new Response(JSON.stringify({ error: 'Missing subscription or payload' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const result = await sendPush(subscription, payload);
  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' },
  });
});
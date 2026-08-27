import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
// New-style secret key, not the legacy service_role JWT -- see
// notify-admin/index.ts for why every function was migrated off it.
const SUPABASE_SERVICE_KEY = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')!)['secret'];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Real client IP has to be read server-side from the request that actually
// hit this function -- anything the browser could supply in the body would
// be trivially spoofable, so it's deliberately ignored even if present.
function clientIp(req: Request): string | null {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Identify the caller from their own JWT rather than trusting a
    // profile id in the body -- this is the only way profile_id gets set.
    const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await callerClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Not signed in' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));

    const { error: insertError } = await admin.from('user_sessions').insert({
      profile_id: user.id,
      user_agent: typeof body.userAgent === 'string' ? body.userAgent.slice(0, 500) : null,
      device_type: typeof body.deviceType === 'string' ? body.deviceType.slice(0, 40) : null,
      os: typeof body.os === 'string' ? body.os.slice(0, 40) : null,
      browser: typeof body.browser === 'string' ? body.browser.slice(0, 40) : null,
      screen_width: Number.isFinite(body.screenWidth) ? Math.round(body.screenWidth) : null,
      screen_height: Number.isFinite(body.screenHeight) ? Math.round(body.screenHeight) : null,
      is_pwa: typeof body.isPwa === 'boolean' ? body.isPwa : null,
      notification_permission: typeof body.notificationPermission === 'string' ? body.notificationPermission.slice(0, 20) : null,
      ip_address: clientIp(req),
    });

    if (insertError) throw insertError;

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('log-session error:', err);
    // Fire-and-forget usage logging -- nothing reads this response body,
    // so keep the real error (which can include raw Postgres details) in
    // the logs only.
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
// New-style secret key, not the legacy service_role JWT -- see
// notify-admin/index.ts for why every function was migrated off it.
const SUPABASE_SERVICE_KEY = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')!)['secret'];
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Same model as extract-receipt -- one constant, one-line swap if a
// stronger model is ever needed.
const MODEL = 'claude-haiku-4-5-20251001';

// Scoped to the GIG, not the user -- realistically one leader per band
// does this, and the actual cost driver is "how many times does this
// one gig's photo set get captioned", not per-user fairness the way
// receipt-scan limits are.
const DAILY_CAPTION_LIMIT_PER_GIG = 5;

// Hard server-side cap regardless of what the client sends -- bounds
// worst-case request size/cost. The UI should itself only offer up to 5
// checkboxes, so this is normally never actually hit, just a backstop.
const MAX_PHOTOS = 5;

// Instagram/X/TikTok profile URLs translate cleanly to an @handle; a
// plain website, Facebook page, or YouTube link doesn't share that
// convention, so those are skipped even if the band has one on file.
const HANDLE_PLATFORMS = ['instagram', 'twitter', 'x.com', 'tiktok'];

function extractHandleFromUrl(url: string): string | null {
  try {
    const withScheme = /^https?:\/\//i.test(url) ? url : 'https://' + url;
    const first = new URL(withScheme).pathname.replace(/^\/+|\/+$/g, '').split('/')[0];
    return first || null;
  } catch {
    return null;
  }
}

// bands.social_links is a free-form [{label, url}] list (same field
// QuotePrintModal/InvoicePrintModal/PublicBandPage already read) -- there's
// no dedicated "handle" field, so this picks the first entry that looks
// like an @-mentionable platform rather than assuming a fixed shape.
function findBandHandle(socialLinks: unknown): string | null {
  if (!Array.isArray(socialLinks)) return null;
  for (const platform of HANDLE_PLATFORMS) {
    const link = socialLinks.find((l: any) =>
      (l?.label || '').toLowerCase().includes(platform.replace('.com', ''))
      || (l?.url || '').toLowerCase().includes(platform)
    );
    const handle = link?.url ? extractHandleFromUrl(link.url) : null;
    if (handle) return handle;
  }
  return null;
}

// Turns "Stoleford Farm" into "StolefordFarm" -- computed here rather than
// left to the model so the venue hashtag is always exactly right, never a
// paraphrase or a misspelling.
function toHashtagWord(str: string): string {
  return (str || '')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('');
}

function weekdayOf(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  try {
    return new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' }).format(new Date(dateStr + 'T00:00:00Z'));
  } catch {
    return '';
  }
}

// Strips any @handle the model produced that isn't one we actually gave
// it -- a real safety net, not just a prompt instruction, since a
// hallucinated or wrong handle ending up in a real public post (tagging
// a stranger, or the wrong band) is a genuine embarrassment risk, not
// just a quality issue. Collapses the resulting double-spaces/stray
// punctuation spacing left behind by a removed mention.
function stripUnknownMentions(caption: string, allowedHandlesLower: Set<string>): string {
  return caption
    .replace(/@([A-Za-z0-9_.]+)/g, (full, handle) => (allowedHandlesLower.has(handle.toLowerCase()) ? full : ''))
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .trim();
}

const CAPTION_SCHEMA = {
  type: 'object',
  properties: {
    caption: {
      type: 'string',
      description: 'A short, upbeat, human-sounding social-media caption for these gig photos, naturally including any real @ mentions provided in the context -- 1-3 sentences.',
    },
    hashtags: {
      type: 'array',
      description: '5-8 relevant genre/mood/live-music discovery hashtags, without the # symbol (e.g. "livemusic" not "#livemusic"). Do NOT include the venue name or day of the week here -- those are added separately.',
      items: { type: 'string' },
    },
    best_time_suggestion: {
      type: 'string',
      description: 'One or two sentences of GENERAL best-practice guidance on when local bands/events tend to get more engagement on Instagram/Facebook. Must read as generic advice, never as if it were derived from this specific band\'s real follower data.',
    },
  },
  required: ['caption', 'hashtags', 'best_time_suggestion'],
};

function buildPrompt(contextBlock: string): string {
  return `You are helping a UK function/covers band draft a social media post from photos taken at a gig they just played.

${contextBlock}

Write into the draft_gig_caption tool:
- A caption that sounds like a real person texting their bandmates and fans, not a marketing team. NEVER use an em dash (—). Avoid hyphens too, unless a word genuinely needs one (a real compound word) -- don't use a hyphen or dash as punctuation to join two clauses; use a full stop, a comma, or "and" instead. Short, punchy sentences. Genuine excitement, real buzz -- make people wish they'd been there. No corporate marketing tone, no cliches like "unforgettable night" unless it actually earns it.
- Naturally weave in the real @ handles given above, if any -- e.g. crediting the band's own account, or a quick shoutout to the musicians tagged. Every handle given above must appear in the caption exactly as given, with the @ symbol, verbatim. If NO handles were given above, do not include any @ mention at all -- never invent, guess, or reuse a handle from anywhere else, under any circumstances.
- 5-8 hashtags per the schema description (genre/mood/discovery only -- not the venue or the day, those are added separately).
- One or two sentences of GENERAL posting-time guidance for a local band's social content. You have NO access to this band's actual follower/engagement data, so never imply you've analysed their specific audience -- phrase it as general best practice only.`;
}

// Chunked rather than String.fromCharCode(...bytes) in one go -- spreading
// a 100KB+ array into an argument list overflows the call stack. Same
// helper as extract-receipt.
function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// Drafts a social caption from a handful of a gig's photos. Client-invoked
// directly (supabase.functions.invoke), same as extract-receipt.
//
// Permission is re-derived server-side, NOT via the caller-scoped-client-
// read trick extract-receipt uses for receipt ownership -- a band leader
// isn't the row-owner of any individual gig_photos row (a musician is),
// so ownership-via-RLS-read doesn't transfer here. Instead this explicitly
// checks profiles.role / band_leaders against the service-role client.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

    const body = await req.json();
    const gigId: string | undefined = body?.gig_id;
    const requestedPhotoIds: string[] = Array.isArray(body?.photo_ids) ? body.photo_ids : [];
    if (!gigId || requestedPhotoIds.length === 0) return json({ error: 'Invalid request' }, 400);

    const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) return json({ error: 'Not signed in' }, 401);

    const { data: gig } = await admin
      .from('gigs')
      .select('band_id, gig_date, venues(name), bands(social_links)')
      .eq('id', gigId)
      .single();
    if (!gig) return json({ error: 'Gig not found' }, 404);

    const { data: callerProfile } = await admin.from('profiles').select('role, full_name').eq('id', caller.id).single();

    let isLeaderOfThisBand = false;
    if (callerProfile?.role !== 'admin' && (gig as any).band_id) {
      const { data: leaderRow } = await admin
        .from('band_leaders')
        .select('profile_id')
        .eq('band_id', (gig as any).band_id)
        .eq('profile_id', caller.id)
        .maybeSingle();
      isLeaderOfThisBand = Boolean(leaderRow);
    }
    if (callerProfile?.role !== 'admin' && !isLeaderOfThisBand) {
      return json({ error: "Only this band's leader or an admin can draft a caption." }, 403);
    }

    // Per-gig daily cap.
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    const { count: gigCountToday } = await admin
      .from('gig_photo_captions')
      .select('id', { count: 'exact', head: true })
      .eq('gig_id', gigId)
      .gte('created_at', since.toISOString());
    if ((gigCountToday ?? 0) >= DAILY_CAPTION_LIMIT_PER_GIG) {
      return json({ error: `This gig has already hit today's caption-drafting limit (${DAILY_CAPTION_LIMIT_PER_GIG}). Try again tomorrow.` }, 429);
    }

    // App-wide monthly ceiling -- same two-tier shape as extract-receipt:
    // trips first, says so plainly, admin-adjustable without a redeploy.
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const { data: limitSetting } = await admin
      .from('app_settings')
      .select('value')
      .eq('key', 'caption_monthly_generation_limit')
      .maybeSingle();
    const monthlyLimit = Number(limitSetting?.value ?? 500);
    const { count: monthCount } = await admin
      .from('gig_photo_captions')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', monthStart.toISOString());
    if ((monthCount ?? 0) >= monthlyLimit) {
      return json({ error: 'Caption drafting has hit its monthly limit for this app. Ask an admin to raise it, or write your own for now.' }, 429);
    }

    // Scoped to this gig too, so a stray/foreign photo id in the request
    // can't be smuggled in and read from elsewhere.
    const { data: photos } = await admin
      .from('gig_photos')
      .select('id, storage_path')
      .eq('gig_id', gigId)
      .in('id', requestedPhotoIds.slice(0, MAX_PHOTOS));
    if (!photos || photos.length === 0) return json({ error: 'No matching photos found for this gig.' }, 404);

    // ── Real, verified data for hashtags/@ mentions -- never left to the
    // model to guess. Confirmed roster only, and only musicians who've
    // actually put a handle in Settings -- someone with no handle on file
    // is simply never mentioned, never guessed at.
    const venueName = (gig as any)?.venues?.name || '';
    const weekday = weekdayOf((gig as any)?.gig_date);
    const bandHandle = findBandHandle((gig as any)?.bands?.social_links);

    const { data: rosterRows } = await admin
      .from('gig_lineup')
      .select('profile_id, profiles(full_name, social_handle)')
      .eq('gig_id', gigId)
      .eq('confirmed', true)
      .not('profile_id', 'is', null);

    const taggableMusicians = (rosterRows || [])
      .map((r: any) => ({ name: r.profiles?.full_name || 'A musician', handle: r.profiles?.social_handle }))
      .filter((m: any) => m.handle);

    const allowedHandlesLower = new Set<string>([
      ...(bandHandle ? [bandHandle.toLowerCase()] : []),
      ...taggableMusicians.map((m) => m.handle.toLowerCase()),
    ]);

    const contextLines = [
      venueName ? `Venue: ${venueName}` : null,
      weekday ? `Day of the gig: ${weekday}` : null,
      bandHandle
        ? `The band's own social handle -- tag it as @${bandHandle} where it fits naturally.`
        : `The band has no social handle on file -- do not invent one.`,
      taggableMusicians.length > 0
        ? `Musicians who can be tagged (use these EXACT handles, nothing else): ` +
          taggableMusicians.map((m) => `${m.name} = @${m.handle}`).join(', ')
        : `No musician on this gig's roster has a social handle on file -- do not tag anyone by name/handle.`,
    ].filter(Boolean).join('\n');

    const imageBlocks = [];
    for (const photo of photos) {
      const { data: file, error: downloadError } = await admin.storage.from('gig-photos').download(photo.storage_path);
      if (downloadError || !file) continue; // skip a single bad download rather than failing the whole draft
      const mediaType = file.type && file.type.startsWith('image/') ? file.type : 'image/webp';
      const base64 = toBase64(await file.arrayBuffer());
      imageBlocks.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } });
    }
    if (imageBlocks.length === 0) return json({ error: "Couldn't read any of those photos -- try again." }, 500);

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        tools: [{
          name: 'draft_gig_caption',
          description: 'Draft a social media caption, hashtags, and general posting-time guidance for a set of gig photos.',
          input_schema: CAPTION_SCHEMA,
        }],
        // Forcing the tool guarantees a structurally valid object back --
        // no fenced-JSON stripping or prose-around-the-answer parsing.
        tool_choice: { type: 'tool', name: 'draft_gig_caption' },
        messages: [{
          role: 'user',
          content: [...imageBlocks, { type: 'text', text: buildPrompt(contextLines) }],
        }],
      }),
    });

    if (!aiRes.ok) {
      const detail = await aiRes.text();
      throw new Error(`Caption service returned ${aiRes.status}: ${detail.slice(0, 300)}`);
    }

    const aiJson = await aiRes.json();
    const toolUse = (aiJson.content || []).find((c: { type: string }) => c.type === 'tool_use');
    if (!toolUse?.input) throw new Error('Caption service returned no structured result');
    const x = toolUse.input;

    const safeCaption = stripUnknownMentions(String(x.caption || ''), allowedHandlesLower);

    // Venue/day hashtags are computed here, not asked of the model --
    // guarantees they're always spelled exactly right, merged with
    // whatever genre/mood tags the model suggested.
    const weekdayTag = toHashtagWord(weekday);
    const venueTag = toHashtagWord(venueName);
    const aiHashtags = Array.isArray(x.hashtags) ? x.hashtags : [];
    const finalHashtags = Array.from(new Set([weekdayTag, venueTag, ...aiHashtags].filter(Boolean)));

    const { data: inserted, error: insertError } = await admin
      .from('gig_photo_captions')
      .insert({
        gig_id: gigId,
        requested_by: caller.id,
        photo_ids: photos.map((p) => p.id),
        caption: safeCaption,
        hashtags: finalHashtags,
        best_time_suggestion: x.best_time_suggestion ?? null,
        raw_response: x,
      })
      .select()
      .single();
    if (insertError) throw insertError;

    return json({ ok: true, caption: inserted });
  } catch (err) {
    console.error('generate-gig-caption error:', err);
    // The real error could be a raw Postgres or AI-provider detail never
    // meant for a client to see -- the caller gets a generic message,
    // same reasoning as extract-receipt.
    return json({ error: 'Something went wrong drafting a caption. Try again in a moment.' }, 500);
  }
});

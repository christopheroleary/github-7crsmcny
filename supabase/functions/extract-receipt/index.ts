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

// Single constant so this is a one-line swap to a stronger model if real
// receipts (faded thermal paper, creases, poor light) turn out to need it.
const MODEL = 'claude-haiku-4-5-20251001';

// This is the only place in the app that spends real money per call, so the
// cap lives here server-side rather than in the UI -- same reasoning as
// record_arcade_play's daily lives check.
const DAILY_EXTRACTION_LIMIT = 50;

// Must stay in sync with src/utils/expenseCategories.js (and therefore with
// the CHECK constraint on expenses.category). Constraining the model to
// these exact strings means the SA103 box mapping in src/utils/sa103Boxes.js
// resolves for free, with no extra guesswork on the client.
const EXPENSE_CATEGORIES = [
  'Travel / mileage',
  'Accommodation',
  'Equipment & consumables',
  'Subsistence',
  'Parking / congestion / tolls',
  'Phone, software & subscriptions',
  'Advertising & promotion',
  'Accountancy & professional fees',
  'Other',
];

const RECEIPT_SCHEMA = {
  type: 'object',
  properties: {
    merchant_name: { type: ['string', 'null'], description: 'Shop or business name as printed' },
    transaction_date: { type: ['string', 'null'], description: 'Date of purchase, strictly YYYY-MM-DD' },
    transaction_time: { type: ['string', 'null'], description: 'Time of purchase, strictly HH:MM (24h)' },
    total: { type: ['number', 'null'], description: 'Grand total actually paid, in pounds (e.g. 12.99)' },
    subtotal: { type: ['number', 'null'], description: 'Net total before VAT, in pounds' },
    vat: { type: ['number', 'null'], description: 'VAT/tax amount, in pounds' },
    vat_number: { type: ['string', 'null'], description: 'Seller VAT registration number if printed' },
    currency: { type: 'string', description: 'ISO code, e.g. GBP. Default GBP if no symbol is visible.' },
    payment_method: { type: ['string', 'null'], description: 'e.g. Visa, Mastercard, Cash, Contactless' },
    line_items: {
      type: 'array',
      description: 'Individual purchased items. Empty array if not legible.',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          quantity: { type: ['number', 'null'] },
          unit_price: { type: ['number', 'null'], description: 'In pounds' },
          total: { type: ['number', 'null'], description: 'In pounds' },
        },
        required: ['description'],
      },
    },
    suggested_category: {
      type: ['string', 'null'],
      enum: [...EXPENSE_CATEGORIES, null],
      description: 'Best-fit UK self-employment expense category for this purchase',
    },
    suggested_description: {
      type: ['string', 'null'],
      description: 'Short human description for an expense line, e.g. "Guitar strings" or "Drinks for band"',
    },
    is_receipt: {
      type: 'boolean',
      description: 'False if the image is not a receipt/invoice at all',
    },
    field_confidence: {
      type: 'object',
      description: 'How clearly each value could actually be read off the image.',
      properties: {
        merchant_name: { type: 'string', enum: ['high', 'medium', 'low'] },
        transaction_date: { type: 'string', enum: ['high', 'medium', 'low'] },
        total: { type: 'string', enum: ['high', 'medium', 'low'] },
        vat: { type: 'string', enum: ['high', 'medium', 'low'] },
      },
    },
  },
  required: ['currency', 'line_items', 'is_receipt'],
};

const PROMPT = `You are reading a photograph of a purchase receipt for a UK self-employed musician's tax records.

Extract the fields into the record_receipt tool.

Critical rules:
- If a value is not clearly legible, return null for it. NEVER guess, infer, or "tidy up" a value you cannot actually read. A blank field the musician fills in themselves is far better than a plausible-looking wrong number silently entering their tax return.
- All money values are in pounds as decimal numbers (12.99, not 1299 and not "£12.99").
- transaction_date must be YYYY-MM-DD. UK receipts are usually DD/MM/YYYY - do not misread 03/04/2026 as 4 March.
- If the total and the line items disagree, trust the printed total.
- Set is_receipt to false if this is not a receipt or invoice (a blurred photo of something else, a blank page, a person).
- Fill in field_confidence honestly. Use "low" for anything you had to squint at, infer from context, or reconstruct from a partially obscured figure. This drives which fields the user is asked to double-check, so over-stating confidence is actively harmful.`;

// Sanity checks the arithmetic rather than trusting the read. OCR errors on
// receipts are overwhelmingly single-digit misreads, and those almost always
// break the net + VAT = total identity -- so this catches a lot for nothing.
// Reported as warnings, never as a correction: the printed receipt is the
// source of truth and a human decides what to do about a mismatch.
function buildQualityWarnings(subtotal: number | null, vat: number | null, total: number | null, lineItems: unknown) {
  const warnings: { code: string; message: string }[] = [];
  const TOLERANCE_PENCE = 2; // rounding on the receipt itself

  if (subtotal != null && vat != null && total != null) {
    const diff = Math.abs(subtotal + vat - total);
    if (diff > TOLERANCE_PENCE) {
      warnings.push({
        code: 'vat_mismatch',
        message: `Net + VAT doesn't add up to the total (out by £${(diff / 100).toFixed(2)}) — worth checking the figures.`,
      });
    }
  }

  if (Array.isArray(lineItems) && lineItems.length > 0 && total != null) {
    let sum = 0;
    let usable = true;
    for (const li of lineItems as { total?: unknown }[]) {
      if (typeof li?.total !== 'number') { usable = false; break; }
      sum += Math.round(li.total * 100);
    }
    // Only flag when the items OVER-shoot the total: a receipt legitimately
    // listing a subset (or carrying a discount line) undershoots all the
    // time, and warning about that would be noise.
    if (usable && sum - total > TOLERANCE_PENCE) {
      warnings.push({
        code: 'line_items_exceed_total',
        message: `The items read add up to more than the total — one of them may have been misread.`,
      });
    }
  }

  return warnings;
}

// Chunked rather than String.fromCharCode(...bytes) in one go -- spreading a
// 100KB+ array into an argument list overflows the call stack.
function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function poundsToPence(v: unknown): number | null {
  if (typeof v !== 'number' || !isFinite(v) || v < 0) return null;
  return Math.round(v * 100);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// Reads a receipt photo and writes the structured fields back onto the row.
//
// Authorization is not reimplemented here: the receipt row is read through
// the CALLER's own JWT-scoped client, so the existing receipts_select RLS
// policy decides. If that read returns nothing, the caller doesn't own it.
// Service-role is only used afterwards, once authorization is established.
//
// Nothing here creates an expense -- extraction only fills in the receipt
// row. The musician confirms the values in the UI, and that confirmation is
// what creates the expense. This is tax data; the model pre-fills, a human
// commits.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  let receiptId: string | undefined;

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

    const body = await req.json();
    receiptId = body?.receipt_id;
    if (!receiptId) return json({ error: 'Invalid request' }, 400);

    const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: receipt, error: receiptError } = await callerClient
      .from('receipts')
      .select('id, profile_id, storage_path, status')
      .eq('id', receiptId)
      .single();

    if (receiptError || !receipt) {
      return json({ error: 'Receipt not found, or you are not authorized to read it' }, 404);
    }

    // Scanning receipts is a Pro feature, checked against the caller's own
    // profile. Admins are always treated as Pro, matching isPro everywhere else.
    const { data: { user: caller } } = await callerClient.auth.getUser();
    const { data: callerProfile } = await admin
      .from('profiles')
      .select('role, subscription_tier')
      .eq('id', caller?.id)
      .single();
    if (callerProfile?.role !== 'admin' && callerProfile?.subscription_tier !== 'pro') {
      return json({ error: 'PRO_REQUIRED: Scanning receipts is a Pro feature — upgrade in My Profile.' }, 403);
    }

    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    const { count } = await admin
      .from('receipts')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', receipt.profile_id)
      .gte('extracted_at', since.toISOString());
    if ((count ?? 0) >= DAILY_EXTRACTION_LIMIT) {
      return json({ error: `Daily scan limit reached (${DAILY_EXTRACTION_LIMIT}). Try again tomorrow, or enter this one by hand.` }, 429);
    }

    // App-wide monthly ceiling, checked across every user. The provider-side
    // spend cap is the real financial backstop, but on its own it fails
    // badly: whoever burns the budget silently takes the feature down for
    // everyone until the billing month rolls over. This trips first, says so
    // plainly, and an admin can raise it in app_settings with no redeploy.
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const { data: limitSetting } = await admin
      .from('app_settings')
      .select('value')
      .eq('key', 'receipt_monthly_scan_limit')
      .maybeSingle();
    const monthlyLimit = Number(limitSetting?.value ?? 3000);
    const { count: monthCount } = await admin
      .from('receipts')
      .select('id', { count: 'exact', head: true })
      .gte('extracted_at', monthStart.toISOString());
    if ((monthCount ?? 0) >= monthlyLimit) {
      return json({
        error: 'Receipt scanning has hit its monthly limit for this app. The photo is still saved — type the details in by hand, or ask an admin to raise the limit.',
      }, 429);
    }

    const { data: file, error: downloadError } = await admin
      .storage.from('receipts').download(receipt.storage_path);
    if (downloadError || !file) throw new Error('Could not read the uploaded image');

    const mediaType = file.type && file.type.startsWith('image/') ? file.type : 'image/webp';
    const base64 = toBase64(await file.arrayBuffer());

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2048,
        tools: [{
          name: 'record_receipt',
          description: 'Record the fields read off a purchase receipt.',
          input_schema: RECEIPT_SCHEMA,
        }],
        // Forcing the tool guarantees a structurally valid object back --
        // no fenced-JSON stripping or prose-around-the-answer parsing.
        tool_choice: { type: 'tool', name: 'record_receipt' },
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: PROMPT },
          ],
        }],
      }),
    });

    if (!aiRes.ok) {
      const detail = await aiRes.text();
      throw new Error(`Extraction service returned ${aiRes.status}: ${detail.slice(0, 300)}`);
    }

    const aiJson = await aiRes.json();
    const toolUse = (aiJson.content || []).find((c: { type: string }) => c.type === 'tool_use');
    if (!toolUse?.input) throw new Error('Extraction service returned no structured result');
    const x = toolUse.input;

    if (x.is_receipt === false) {
      await admin.from('receipts').update({
        status: 'failed',
        extraction_error: "That doesn't look like a receipt — you can still keep the image and type the details in by hand.",
        raw_extraction: x,
        extracted_at: new Date().toISOString(),
      }).eq('id', receiptId);
      return json({ ok: false, status: 'failed', error: 'Not a receipt' });
    }

    const category = EXPENSE_CATEGORIES.includes(x.suggested_category) ? x.suggested_category : null;

    const totalPence = poundsToPence(x.total);
    const subtotalPence = poundsToPence(x.subtotal);
    const vatPence = poundsToPence(x.vat);
    const warnings = buildQualityWarnings(subtotalPence, vatPence, totalPence, x.line_items);

    const { data: updated, error: updateError } = await admin
      .from('receipts')
      .update({
        status: 'extracted',
        merchant_name: x.merchant_name ?? null,
        transaction_date: x.transaction_date ?? null,
        transaction_time: x.transaction_time ?? null,
        total_pence: totalPence,
        subtotal_pence: subtotalPence,
        vat_pence: vatPence,
        field_confidence: x.field_confidence ?? null,
        quality_warnings: warnings.length ? warnings : null,
        vat_number: x.vat_number ?? null,
        currency: x.currency || 'GBP',
        payment_method: x.payment_method ?? null,
        line_items: Array.isArray(x.line_items) ? x.line_items : null,
        suggested_category: category,
        raw_extraction: x,
        extraction_error: null,
        extracted_at: new Date().toISOString(),
      })
      .eq('id', receiptId)
      .select()
      .single();
    if (updateError) throw updateError;

    return json({ ok: true, receipt: updated });
  } catch (err) {
    console.error('extract-receipt error:', err);
    const message = err instanceof Error ? err.message : String(err);
    // Mark the row failed rather than leaving it stuck on 'pending' forever
    // -- the image is still a perfectly valid record, it just needs the
    // fields typed in manually.
    if (receiptId) {
      await admin.from('receipts').update({
        status: 'failed',
        extraction_error: message.slice(0, 500),
        extracted_at: new Date().toISOString(),
      }).eq('id', receiptId);
    }
    // `message` (the real error) is still stored on the row above, where
    // RLS limits it to the receipt's owner and admins -- the caller gets
    // a generic response instead, since the underlying error could be a
    // raw Postgres or AI-provider detail never meant for a client to see.
    return json({ error: 'Something went wrong reading that receipt.' }, 500);
  }
});

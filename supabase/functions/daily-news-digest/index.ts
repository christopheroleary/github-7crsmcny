import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const TARGET_UK_HOUR = 6; // Runs once, first thing in the morning.
const MAX_ARTICLES = 10;
// A week, not 24h -- practical/niche gigging topics don't publish daily in
// the UK press. Confirmed empirically: even at a week, the practical topic
// queries alone (no MusicRadar/Rolling Stone) return only ~3 candidates
// total -- there just isn't much UK press coverage of "session musician
// tips" or "how to get more gigs" on any timescale a free RSS digest can
// realistically pull from.
const MAX_AGE_HOURS = 24 * 7;
const CLEANUP_AFTER_DAYS = 14;

// Google News' search RSS (news.google.com/rss/search?q=...) needs no API
// key and supports the same operators as google.com search (site:, -word
// exclusions, quoted phrases) -- it's not a documented/contracted API, but
// it's a well-established pattern and the only genuinely free option that
// covers this breadth of topics. `-ring -jewellery -jewelry -diamond`
// exists specifically because "wedding band" without it returns jewellery
// results as often as music ones.
//
// Practical/how-to topics are listed FIRST and the two broad publication
// queries LAST -- order matters because the round-robin selection below
// takes queries in this order, so practical content wins the available
// slots whenever it exists, and musicradar.com/rollingstone.com (dominated
// by celebrity-interview content -- exactly what a gigging-musician digest
// isn't for) only fill in the remaining slots. They can't just be dropped:
// tested removing them entirely and the practical topics alone returned 3
// candidates for a 10-article digest, not 10 -- worse than a digest that's
// mostly-practical-with-some-general-music-news.
// musiciansunion.org.uk keeps its own query too -- confirmed by checking
// its feed directly that it's genuinely practical (funding, touring
// support, career advice), even though it's mostly evergreen resource
// pages rather than dated news, so it rarely has anything inside even the
// 7-day window.
const QUERIES = [
  'function band UK musician -ring -jewellery -jewelry -diamond -engagement',
  'wedding entertainment band UK music -ring -jewellery -jewelry -diamond',
  'session musician UK',
  'UK touring musician band tour',
  'live music performance UK venue',
  'music technology gear UK',
  'musical instrument news UK',
  'gigging musician tips UK',
  'live sound PA gear musician UK',
  'how to get more gigs band UK',
  'cover band UK',
  'busking UK musicians',
  'musicians union UK',
  'site:musiciansunion.org.uk',
  'site:musicradar.com',
  'site:rollingstone.com music',
];

// Belt-and-braces on top of the query-level exclusions -- catches jewellery
// results that slipped through, and requires at least one genuinely
// music/gig-related term so an unrelated story sharing a keyword (e.g. a
// literal "band" as in a rubber band) doesn't make the cut.
const JEWELLERY_TERMS = /\b(engagement ring|wedding ring|diamond ring|jewellery|jewelry|jeweller)\b/i;
const MUSIC_TERMS = /\b(band|music|musician|singer|guitar|drummer|bassist|keyboard|gig|concert|tour|touring|song|album|venue|performance|instrument|orchestra|dj|wedding)\b/i;

// MusicRadar/Rolling Stone-style celebrity interview pieces are almost
// always headlined as a direct quote ("I guess some of you..."), which is
// a strong, cheap signal for "famous person says something" content --
// exactly what a performing musician doesn't need in a gigging-focused
// digest -- as opposed to practical/how-to journalism, which is essentially
// never quote-led.
function looksLikeCelebrityQuote(title: string): boolean {
  return /^["“]/.test(title.trim());
}

function isRelevant(title: string, description: string): boolean {
  if (looksLikeCelebrityQuote(title)) return false;
  const text = (title + ' ' + description).toLowerCase();
  if (JEWELLERY_TERMS.test(text)) return false;
  return MUSIC_TERMS.test(text);
}

function extractTag(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  if (!m) return '';
  let val = m[1];
  const cdata = val.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  if (cdata) val = cdata[1];
  return val.trim();
}

// &amp; must decode first (a literal "&" in the source was itself escaped
// to "&amp;amp;" when Google wrapped the description in HTML, so this is
// often two rounds of encoding for a single character) -- &nbsp; only
// exists as an entity because &amp; already ran.
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

// Google News' <description> is the raw markup <a href="...">Title</a>
// &nbsp;&nbsp;<font ...>Source</font> -- but HTML-entity-escaped (&lt;a
// href=...&gt;), not literal tags, so entities have to decode BEFORE tag
// stripping runs, not after -- stripping first (the naive order) finds no
// literal < > to match at all and leaves the whole escaped mess untouched.
function stripHtml(s: string): string {
  return decodeEntities(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

interface RawItem {
  title: string;
  link: string;
  pubDate: string;
  description: string;
  source: string;
}

function parseRssItems(xml: string): RawItem[] {
  const items: RawItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(xml))) {
    const block = m[1];
    const source = decodeEntities(extractTag(block, 'source'));
    let title = decodeEntities(extractTag(block, 'title'));
    // Google News appends " - PublisherName" to every single title --
    // strip it using the source field we already extracted, rather than
    // guessing at a generic " - " split (a real headline can legitimately
    // contain " - " itself).
    if (source && title.endsWith(' - ' + source)) {
      title = title.slice(0, -(' - ' + source).length).trim();
    }
    items.push({
      title,
      link: extractTag(block, 'link'),
      pubDate: extractTag(block, 'pubDate'),
      description: stripHtml(extractTag(block, 'description')),
      source,
    });
  }
  return items;
}

async function fetchQuery(query: string): Promise<RawItem[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-GB&gl=GB&ceid=GB:en`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GigManagerNewsBot/1.0)' } });
    if (!res.ok) return [];
    return parseRssItems(await res.text());
  } catch {
    return []; // One bad query shouldn't take down the whole digest.
  }
}

function normaliseTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const force = url.searchParams.get('force') === '1';

  const ukHour = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: 'numeric', hour12: false }).format(new Date())
  );
  if (!force && ukHour !== TARGET_UK_HOUR) {
    return new Response(JSON.stringify({ ok: true, skipped: 'not the scheduled hour', ukHour }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Idempotency: cron fires across a two-hour UTC window to survive the
    // BST/GMT switch (same pattern as gig-day-reminder), so this can be
    // invoked twice on the same UK day -- skip the second run rather than
    // fetching and inserting a duplicate batch.
    if (!force) {
      const { count } = await admin
        .from('news_articles')
        .select('id', { count: 'exact', head: true })
        .eq('batch_date', new Date().toISOString().slice(0, 10));
      if (count && count > 0) {
        return new Response(JSON.stringify({ ok: true, skipped: 'already ran today' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    const results = await Promise.all(QUERIES.map(fetchQuery));
    const cutoff = Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000;

    const seenUrls = new Set<string>();
    const seenTitles = new Set<string>();
    const candidates: Array<RawItem & { publishedAt: number; queryIndex: number }> = [];

    for (let queryIndex = 0; queryIndex < results.length; queryIndex++) {
      for (const item of results[queryIndex]) {
        if (!item.title || !item.link) continue;
        const publishedAt = item.pubDate ? Date.parse(item.pubDate) : NaN;
        if (!Number.isFinite(publishedAt) || publishedAt < cutoff) continue;
        if (!isRelevant(item.title, item.description)) continue;

        const titleKey = normaliseTitle(item.title);
        if (seenUrls.has(item.link) || seenTitles.has(titleKey)) continue;
        seenUrls.add(item.link);
        seenTitles.add(titleKey);

        // Google News RSS <description> is ALWAYS just the title re-wrapped
        // as a link plus the source name appended -- never a real snippet,
        // for any article, by design of the feed. Detected as "starts with
        // the title" rather than exact-equality since the source name is
        // still attached after the title text. In practice this means
        // summary is empty for every article; kept as a check (rather than
        // just hardcoding '') in case Google ever changes this, and because
        // some non-Google-News sources reached via site: queries could
        // theoretically differ.
        const normalisedDescription = normaliseTitle(item.description);
        const summary = normalisedDescription && !normalisedDescription.startsWith(titleKey) ? item.description : '';

        candidates.push({
          ...item,
          description: summary,
          publishedAt,
          queryIndex,
        });
      }
    }

    // Round-robin across queries rather than a flat sort -- a flat "most
    // recent wins" sort let whichever single query happened to have the
    // most fresh hits fill every slot, crowding out every other topic even
    // when they had relevant candidates too. Taking each query's best (most
    // recent) unclaimed item in turn, one round at a time, spreads the
    // final picks across topics while still favouring recency within each.
    const byQuery = new Map<number, typeof candidates>();
    for (const c of candidates) {
      const list = byQuery.get(c.queryIndex) ?? [];
      list.push(c);
      byQuery.set(c.queryIndex, list);
    }
    for (const list of byQuery.values()) {
      list.sort((a, b) => b.publishedAt - a.publishedAt);
    }

    // Even round-robin wasn't enough on its own: MusicRadar/Rolling Stone
    // between them have far more daily supply than the practical topics do,
    // so once practical queries run dry (round 2-3), round-robin just keeps
    // handing every remaining slot to whichever of the two still has stock
    // -- confirmed live, 7 of 10 chosen articles were MusicRadar/Rolling
    // Stone on a normal day. Capping their combined contribution at half
    // the digest means the count sometimes falls short of MAX_ARTICLES on a
    // quiet day for practical topics, which is the honest tradeoff: fewer
    // articles, not more famous-band coverage padding the list back to 10.
    const fallbackQueryIndices = new Set(
      [QUERIES.indexOf('site:musicradar.com'), QUERIES.indexOf('site:rollingstone.com music')].filter((i) => i >= 0)
    );
    const fallbackCap = Math.ceil(MAX_ARTICLES / 2);

    const chosen: typeof candidates = [];
    let fallbackCount = 0;
    let round = 0;
    while (chosen.length < MAX_ARTICLES) {
      let addedAny = false;
      for (const [queryIndex, list] of byQuery.entries()) {
        if (chosen.length >= MAX_ARTICLES) break;
        const isFallback = fallbackQueryIndices.has(queryIndex);
        if (isFallback && fallbackCount >= fallbackCap) continue;
        if (list[round]) {
          chosen.push(list[round]);
          if (isFallback) fallbackCount++;
          addedAny = true;
        }
      }
      if (!addedAny) break;
      round++;
    }

    if (chosen.length > 0) {
      const { error: insertError } = await admin.from('news_articles').upsert(
        chosen.map((c) => ({
          title: c.title,
          summary: c.description || null,
          url: c.link,
          source: c.source || null,
          published_at: new Date(c.publishedAt).toISOString(),
        })),
        { onConflict: 'url', ignoreDuplicates: true }
      );
      if (insertError) throw insertError;
    }

    // Light housekeeping -- a handful of rows a day for years is still
    // trivial, but no reason to keep them once they're too old to matter.
    await admin
      .from('news_articles')
      .delete()
      .lt('batch_date', new Date(Date.now() - CLEANUP_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));

    return new Response(JSON.stringify({ ok: true, inserted: chosen.length, candidates: candidates.length }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('daily-news-digest error:', err);
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

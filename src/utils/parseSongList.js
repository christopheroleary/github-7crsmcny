// Turns a freeform pasted setlist (numbered or not, all-caps or not, split
// into sections like "Set 1"/"Encore" or just one long list, with the
// artist sometimes appended after the title) into a flat array of parsed
// song rows for review before import. Deliberately heuristic rather than
// exhaustive -- the UI that consumes this always shows a review/edit step,
// so an occasional wrong split just means one row needs a manual tweak
// rather than a silently wrong import.

const SECTION_KEYWORDS = [
  /^set\s*\d+\b/i,
  /^encore\d*\b/i,
  /^backups?\b/i,
  /^spares?\b/i,
  /^reserves?\b/i,
  /^extras?\b/i,
  /^first\s*set\b/i,
  /^second\s*set\b/i,
  /^third\s*set\b/i,
  /^main\s*set\b/i,
  /^ceremony\b/i,
  /^first\s*dance\b/i,
  /^walk[\s-]?in\b/i,
  /^cocktail\s*hour\b/i,
  /^drinks?\s*reception\b/i,
];

function looksLikeSectionHeader(line) {
  const withoutColon = line.replace(/:\s*$/, '').trim();
  if (!withoutColon) return false;
  // A short line ending in a colon is a strong generic signal even for
  // section names we don't otherwise recognise (e.g. a band's own labels).
  if (/:\s*$/.test(line) && withoutColon.split(/\s+/).length <= 4) return true;
  return SECTION_KEYWORDS.some((re) => re.test(withoutColon));
}

// Track-number prefixes ("1. ", "12) ", "3: ", "4- ") always have a
// delimiter between the digits and the space -- requiring it avoids
// mangling real titles that start with a number, e.g. "99 Red Balloons"
// or "4 Non Blondes", which have no such delimiter.
function stripLeadingNumber(line) {
  return line.replace(/^\s*\d{1,3}\s*[.):-]\s+/, '').trim();
}

function splitTitleArtist(line) {
  let m = line.match(/^(.+?)\s*\(([^()]+)\)\s*$/);
  if (m) return { title: m[1].trim(), artist: m[2].trim() };

  m = line.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (m) return { title: m[1].trim(), artist: m[2].trim() };

  m = line.match(/^(.+?)\s+by\s+(.+)$/i);
  if (m) return { title: m[1].trim(), artist: m[2].trim() };

  return { title: line.trim(), artist: '' };
}

function toTitleCaseIfShouting(text) {
  if (!text) return text;
  const letters = text.replace(/[^A-Za-z]/g, '');
  if (letters.length > 2 && letters === letters.toUpperCase()) {
    // Capitalise after whitespace/start/hyphen only -- not after an
    // apostrophe, so "DON'T" becomes "Don't" rather than "Don'T".
    return text.toLowerCase().replace(/(^|[\s-])([a-z])/g, (m, sep, c) => sep + c.toUpperCase());
  }
  return text;
}

// A track-number-style prefix can also carry the section inline on the same
// line rather than as its own header line, e.g. "30. ENCORE: Don't Look
// Back In Anger" -- the label applies to this song (and, like a standalone
// header, every song after it until the next label/header appears).
const INLINE_LABEL_RE = /^(set\s*\d+|encore\d*|backups?|spares?|reserves?|extras?)\s*:\s*(.+)$/i;

export function parseSongList(rawText) {
  const lines = (rawText || '').split(/\r?\n/);
  const result = [];
  let currentSection = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (looksLikeSectionHeader(line)) {
      currentSection = toTitleCaseIfShouting(line.replace(/:\s*$/, '').trim());
      continue;
    }

    let stripped = stripLeadingNumber(line);

    const inlineLabel = stripped.match(INLINE_LABEL_RE);
    if (inlineLabel) {
      currentSection = toTitleCaseIfShouting(inlineLabel[1].trim());
      stripped = inlineLabel[2].trim();
    }

    const { title, artist } = splitTitleArtist(stripped);
    if (!title) continue;

    result.push({
      section: currentSection,
      raw: rawLine,
      title: toTitleCaseIfShouting(title),
      artist: toTitleCaseIfShouting(artist),
    });
  }

  return result;
}

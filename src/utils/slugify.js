// Normalises free text into the lowercase-alphanumeric-hyphen shape the
// bands_public_slug_format CHECK constraint requires (see
// 20260827140000_public_band_page.sql) -- kept permissive rather than
// rejecting: strip anything that isn't a letter/digit, collapse runs of
// separators into one hyphen, trim leading/trailing hyphens.
export function slugify(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents so "café" -> "cafe"
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

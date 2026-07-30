// Best-effort town/city extraction from a free-text venue address. There's no
// dedicated town/city field today — addresses are one comma-separated blob in
// inconsistent formats (some start with a postcode, some with a venue name).
// This strips the trailing country and a UK-postcode-shaped segment, then
// takes the last remaining part. Known limitation: when a county sits between
// the town and postcode (e.g. "…, Cheltenham, Gloucestershire, GL51 6NL, UK"),
// this returns the county, not the town.
const UK_POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

export function parseTownFromAddress(address) {
  if (!address) return '';
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return '';

  if (parts.length > 1 && /united kingdom|^uk$/i.test(parts[parts.length - 1])) {
    parts.pop();
  }
  if (parts.length > 1 && UK_POSTCODE_RE.test(parts[parts.length - 1])) {
    parts.pop();
  }

  return parts[parts.length - 1] || '';
}

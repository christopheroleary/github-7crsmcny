// Suppliers are typed in as anything from a full URL to a bare
// "instagram.com/handle" to a plain "@handle" with no domain at all.
// Only the first two are actually linkable -- a bare handle carries no
// platform information, so rather than guess (and risk sending someone to
// the wrong app/site) this returns null and the caller falls back to
// plain text.
export function normalizeExternalUrl(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.includes('.')) return 'https://' + trimmed;
  return null;
}

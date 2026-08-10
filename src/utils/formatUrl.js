// Strips the protocol/www and trailing slash so a URL reads cleanly on a
// document (e.g. "thetravellinghands.com" instead of
// "https://www.thetravellinghands.com/") while the underlying href/value
// keeps the full original URL.
export function displayUrl(url) {
  if (!url) return '';
  return url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');
}

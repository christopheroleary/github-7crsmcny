// wa.me needs digits-only, international format, no leading 0 or +.
// UK-specific: 07700 900123 -> 447700900123. Numbers already starting
// with a country code (44 or +44) are left as-is.
export function toWhatsAppNumber(phone) {
  if (!phone) return null;
  const digits = phone.replace(/[^\d]/g, '');
  if (!digits) return null;
  if (digits.startsWith('44')) return digits;
  if (digits.startsWith('0')) return '44' + digits.slice(1);
  return digits;
}

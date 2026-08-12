import { formatShortDate } from './formatDate.js';

// Two variants, not one -- a first-time supplier and one the band has
// worked with three times before read very differently if sent the same
// "lovely to meet you" line, and the whole point here is not sounding
// like a cold call. `hasWorkedBefore` is just "does this supplier appear
// on any OTHER gig_suppliers row for this band besides the current one".
export function buildSupplierFollowUpEmail({ supplier, gig, bandName, hasWorkedBefore }) {
  const greetName = supplier.owner_name || supplier.company_name;
  const venueName = gig?.venues?.name || 'the gig';
  const dateStr = gig?.gig_date ? formatShortDate(gig.gig_date) : 'the other day';
  const band = bandName || 'the band';

  if (hasWorkedBefore) {
    return {
      subject: 'Great working with you again!',
      body:
        `Hi ${greetName},\n\n` +
        `Always a pleasure crossing paths with ${supplier.company_name} — great working with you again at ${venueName} on ${dateStr}.\n\n` +
        `Let us know if there's ever a gig where recommending each other makes sense — always happy to help each other out.\n\n` +
        `Thanks again!\n\n${band}`,
    };
  }

  return {
    subject: `Great meeting you at ${venueName}!`,
    body:
      `Hi ${greetName},\n\n` +
      `Great to meet you at ${venueName} on ${dateStr} — ${band} really enjoyed working alongside ${supplier.company_name}.\n\n` +
      `If you're ever putting a band forward to a couple or client, we'd love to be considered, and always happy to send over a demo. Hope our paths cross again soon!\n\n` +
      `Thanks again for a great day.\n\n${band}`,
  };
}

export function buildSupplierMailtoHref(email, subject, body) {
  return 'mailto:' + encodeURIComponent(email) + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
}

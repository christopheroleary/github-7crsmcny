// Drop a leading "The " so space-constrained UI (calendar chips, the gig
// grid's band column) shows more of what actually identifies the band.
export function displayBandName(name) {
  if (!name) return name;
  return name.replace(/^the\s+/i, '').trim();
}

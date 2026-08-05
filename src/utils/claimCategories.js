// Keep in sync with the CHECK constraint on musician_claim_items.category
// (see migration 20260805210000_itemise_musician_claims.sql) -- shared by
// the musician's claim form and the admin review list so the two dropdowns
// (and the database) never drift apart.
export const CLAIM_CATEGORIES = [
  'Fee',
  'Travel / mileage',
  'Accommodation',
  'Equipment & consumables',
  'Subsistence',
  'Parking / congestion / tolls',
  'Other',
];

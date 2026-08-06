// Keep in sync with the CHECK constraint on expenses.category (see migration
// 20260805223000_add_musician_expenses.sql). Shares most categories with
// claimCategories.js -- travel, accommodation, equipment, subsistence,
// parking apply to both a claim billed to a band and a personal expense --
// but drops "Fee" (not applicable to money a musician spent themselves) and
// adds a few that only make sense as personal business costs, not something
// a band would ever reimburse.
export const EXPENSE_CATEGORIES = [
  'Travel / mileage',
  'Accommodation',
  'Equipment & consumables',
  'Subsistence',
  'Parking / congestion / tolls',
  'Phone, software & subscriptions',
  'Advertising & promotion',
  'Accountancy & professional fees',
  'Other',
];

// Keep in sync with the CHECK constraint on income.category (see migration
// 20260806120000_add_musician_income.sql). For non-gig money in -- selling
// gear, teaching, a one-off session outside the band -- as opposed to
// gig fee income, which comes through paid musician_claims instead.
export const INCOME_CATEGORIES = [
  'Sale of equipment/asset',
  'Teaching / tuition',
  'Session work (other)',
  'Royalties',
  'Other income',
];

// Maps this app's categories onto HMRC's real Self Assessment box numbers,
// for the full self-employment form (SA103F). Reference only -- not tax
// advice, and box numbers can shift year to year, so treat this as a
// starting point to double-check against the current year's actual form.
//
// Important asymmetry: expense categories genuinely map to different boxes
// (17-30) because HMRC wants expenses broken out by type. Claim income
// (Fee, Travel, etc. paid by a band) does NOT work the same way -- ALL of
// it is simply turnover, box 15 (full form) / box 9 (short form),
// regardless of which category a line was tagged with. So this file only
// maps EXPENSE_CATEGORIES; claim-item categories are informational for the
// musician's own tracking, not a tax-box distinction, and deliberately
// aren't given per-category box labels anywhere in the UI.
//
// Sources (see the MTD research artifact from this session): SA103F Notes
// 2026, boxes 17-30; box 15/16 (turnover / other income) confirmed via
// gov.uk SA103F guidance.
export const SA103_EXPENSE_BOX = {
  'Travel / mileage': 'Box 20',
  'Accommodation': 'Box 20',
  'Subsistence': 'Box 20',
  'Parking / congestion / tolls': 'Box 20',
  'Equipment & consumables': 'Box 30',
  'Phone, software & subscriptions': 'Box 23',
  'Advertising & promotion': 'Box 24',
  'Accountancy & professional fees': 'Box 28',
  'Other': 'Box 30',
};

// Full form / short form box references for the two income sources.
export const SA103_TURNOVER_BOX = { full: 'Box 15', short: 'Box 9' };
export const SA103_OTHER_INCOME_BOX = { full: 'Box 16', short: 'Box 10' };

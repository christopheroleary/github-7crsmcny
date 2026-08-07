// HMRC simplified-expenses flat mileage rate for cars/vans. Keyed by tax-year
// start year (not a single constant) because the rate changed for the first
// time since 2011/12 -- 45p rose to 55p per mile (first 10,000 business
// miles/year) from the 2026/27 tax year onwards. Looking a prior tax year's
// records up should still show the rate that actually applied then, not
// today's rate applied retroactively.
export function mileageRateForTaxYear(startYear) {
  const firstRate = startYear >= 2026 ? 0.55 : 0.45;
  return { firstRate, firstThreshold: 10000, afterRate: 0.25 };
}

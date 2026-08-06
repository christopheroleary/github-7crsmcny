import { todayStr } from './formatDate.js';

// UK tax year runs 6 April to 5 April. Derived from todayStr() (UK-local
// date string) rather than a raw `new Date()` comparison -- same DST-safety
// reasoning as todayStr() itself: a server/browser running in a different
// local timezone must not shift which tax year "today" falls into.
function currentTaxYearStartYear() {
  const [y, m, d] = todayStr().split('-').map(Number);
  const beforeApr6 = m < 4 || (m === 4 && d < 6);
  return beforeApr6 ? y - 1 : y;
}

// Most recent tax years first, current year included.
export function taxYearOptions(count = 4) {
  const current = currentTaxYearStartYear();
  return Array.from({ length: count }, (_, i) => current - i).map((startYear) => ({
    startYear,
    start: `${startYear}-04-06`,
    end: `${startYear + 1}-04-05`,
    label: `${startYear}/${String(startYear + 1).slice(-2)}`,
  }));
}

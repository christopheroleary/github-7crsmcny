// Shared month-grid math, originally built for DateInput.jsx's calendar
// picker and now reused by GigCalendar.jsx too -- one source of truth for
// "what does a month look like as a 7-column grid" rather than two copies
// drifting apart.

export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Monday-first index (0=Mon..6=Sun) for a JS Date.getDay() (0=Sun..6=Sat).
export function mondayIndex(jsDay) {
  return (jsDay + 6) % 7;
}

// Always exactly 42 cells (6 full weeks) so the panel/grid is the same
// height every month -- otherwise a 4-week Feb next to a 6-week Aug would
// jump the whole page as you page through months.
export function buildMonthGrid(year, month) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstWeekday = mondayIndex(new Date(year, month - 1, 1).getDay());
  const prevMonthDays = new Date(year, month - 1, 0).getDate();

  const cells = [];
  for (let i = 0; i < firstWeekday; i++) {
    cells.push({ day: prevMonthDays - firstWeekday + 1 + i, monthOffset: -1 });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, monthOffset: 0 });
  }
  let nextDay = 1;
  while (cells.length < 42) {
    cells.push({ day: nextDay++, monthOffset: 1 });
  }
  return cells;
}

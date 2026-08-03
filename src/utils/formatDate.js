export function formatFullDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'short', year: 'numeric',
    });
  }
  
  export function formatShortDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-GB', {
      weekday: 'short', day: 'numeric', month: 'short',
    });
  }
  
  // Splits a date for the gig card's ticket-stub display (weekday above a big
  // day number, month below). Only surfaces the year when it isn't the current
  // one, since most gigs don't need it and it'd otherwise clutter every ticket.
  export function formatTicketStub(dateStr) {
    if (!dateStr) return { day: '—', weekday: '', month: '' };
    const d = new Date(dateStr + 'T00:00:00');
    const weekday = d.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase();
    const month = d.toLocaleDateString('en-GB', { month: 'short' }).toUpperCase();
    const year = d.getFullYear();
    const showYear = year !== new Date().getFullYear();
    return { day: d.getDate(), weekday, month: showYear ? `${month} ${year}` : month };
  }

  // Compact weekday + day for dense grids where the month is already shown
  // separately (e.g. as a section header) — "Thu 4" rather than "Thu 4 Jun".
  export function formatCompactDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' });
  }

  export function formatMonthYear(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  }

  // UK-local date, not UTC -- new Date().toISOString() reports the UTC day,
  // which is still "yesterday" for the first hour after local midnight
  // during BST (UTC+1). That silently misclassified gigs as upcoming/not-
  // yet-past for that first hour, the same class of DST bug already fixed
  // in the gig-day-reminder cron job.
  function ukToday() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
  }

  export function todayStr() {
    return ukToday();
  }

  export function twelveMonthsAgoStr() {
    const [y, m, d] = ukToday().split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    date.setUTCMonth(date.getUTCMonth() - 11);
    date.setUTCDate(1);
    return date.toISOString().slice(0, 10);
  }
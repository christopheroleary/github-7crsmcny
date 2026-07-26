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

  export function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }
  
  export function twelveMonthsAgoStr() {
    const d = new Date();
    d.setMonth(d.getMonth() - 11);
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  }
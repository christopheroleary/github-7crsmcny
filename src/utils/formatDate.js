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
  
  export function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }
  
  export function twelveMonthsAgoStr() {
    const d = new Date();
    d.setMonth(d.getMonth() - 11);
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  }
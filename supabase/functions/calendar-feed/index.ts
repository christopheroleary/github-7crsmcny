import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

function icsDateAllDay(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return y + mo + da;
}

function escapeIcs(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  let result = '';
  let current = '';
  for (const char of line) {
    if (encoder.encode(current + char).length > 75) {
      result += current + '\r\n ';
      current = char;
    } else {
      current += char;
    }
  }
  return result + current;
}

function formatTime(t: string): string {
  return t.slice(0, 5);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get('token');

  if (!token) {
    return new Response('Missing token', { status: 400 });
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, full_name')
    .eq('calendar_token', token)
    .single();

  if (profileError || !profile) {
    return new Response('Invalid token', { status: 401 });
  }

  const { data: lineupRows, error: lineupError } = await supabase
    .from('gig_lineup')
    .select(`
      confirmed,
      gig_id,
      instruments(name),
      vocal_role,
      gigs(
        id, gig_date, start_time, end_time, load_in_time,
        status, notes, parking_notes,
        venues(name, address),
        bands(name)
      )
    `)
    .eq('profile_id', profile.id);

  if (lineupError) {
    return new Response('Error fetching gigs', { status: 500 });
  }

  const rows = (lineupRows || []).filter((r: any) => {
    const status = r.gigs?.status;
    return status && status !== 'cancelled';
  });

  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const calName = escapeIcs((profile.full_name || 'My') + ' Gigs');

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Gig Manager//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:' + calName,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];

  for (const row of rows) {
    const gig = row.gigs as any;
    if (!gig?.gig_date) continue;

    const venueName = gig.venues?.name || '';
    const venueAddress = gig.venues?.address || '';
    const bandName = gig.bands?.name || '';
    const instrument = row.instruments?.name || '';
    const vocalRole = row.vocal_role;
    const confirmed = row.confirmed;

    // Build time string for summary
    const timeStr = gig.start_time ? formatTime(gig.start_time) : '';
    const endTimeStr = gig.end_time ? formatTime(gig.end_time) : '';
    const timeRange = timeStr
      ? (endTimeStr ? timeStr + '-' + endTimeStr : timeStr)
      : '';

    // Summary includes time and pending status
    const gigStatus = confirmed ? '' : ' (Pending)';
    const summaryParts = [timeRange, bandName, venueName].filter(Boolean);
    const summary = escapeIcs(summaryParts.join(' · ') + gigStatus);

    // Location
    const location = escapeIcs([venueName, venueAddress].filter(Boolean).join(', '));

    // Description — full details
    const descParts: string[] = [];
    if (timeRange) descParts.push('Time: ' + timeRange);
    if (gig.load_in_time) descParts.push('Load in: ' + formatTime(gig.load_in_time));
    if (instrument) descParts.push('Playing: ' + instrument);
    if (vocalRole === 'lead') descParts.push('Vocals: Lead');
    if (vocalRole === 'backing') descParts.push('Vocals: Backing');
    if (gig.parking_notes) descParts.push('Parking: ' + gig.parking_notes);
    if (gig.notes) descParts.push('Notes: ' + gig.notes);
    const description = escapeIcs(descParts.join('\n'));

    // All-day event — no timezone issues
    const dateVal = icsDateAllDay(gig.gig_date);
    const dtStart = 'DTSTART;VALUE=DATE:' + dateVal;
    const dtEnd = 'DTEND;VALUE=DATE:' + dateVal;

    const uid = escapeIcs(gig.id + '@gigmanager');
    const statusTag = confirmed ? 'CONFIRMED' : 'TENTATIVE';

    lines.push('BEGIN:VEVENT');
    lines.push(foldLine('UID:' + uid));
    lines.push('DTSTAMP:' + now);
    lines.push(dtStart);
    lines.push(dtEnd);
    lines.push(foldLine('SUMMARY:' + summary));
    if (location) lines.push(foldLine('LOCATION:' + location));
    if (description) lines.push(foldLine('DESCRIPTION:' + description));
    lines.push('STATUS:' + statusTag);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

  const body = lines.join('\r\n') + '\r\n';

  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="my-gigs.ics"',
      'Cache-Control': 'no-cache',
    },
  });
});

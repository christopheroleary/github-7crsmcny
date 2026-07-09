import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

const FEED_BASE = 'https://uzblypxepztdramotjcc.supabase.co/functions/v1/calendar-feed';

export default function CalendarFeed({ profileId }) {
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [googleCopied, setGoogleCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    supabase
      .from('profiles')
      .select('calendar_token')
      .eq('id', profileId)
      .single()
      .then(({ data }) => {
        setToken(data ? data.calendar_token : null);
        setLoading(false);
      });
  }, [profileId]);

  function getFeedUrl(t) {
    return t ? FEED_BASE + '?token=' + t : null;
  }

  async function handleCopy() {
    const url = getFeedUrl(token);
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  async function handleGoogleCalendar() {
    const url = getFeedUrl(token);
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setGoogleCopied(true);
    setTimeout(() => setGoogleCopied(false), 4000);
    window.open('https://calendar.google.com/calendar/r/settings/addbyurl', '_blank', 'noopener,noreferrer');
  }

  async function handleRegenerate() {
    const ok = window.confirm(
      'Regenerate your calendar link? Your current link will stop working and you\'ll need to re-subscribe in your calendar app.'
    );
    if (!ok) return;
    setRegenerating(true);
    const newToken = crypto.randomUUID();
    const { error } = await supabase
      .from('profiles')
      .update({ calendar_token: newToken })
      .eq('id', profileId);
    if (error) {
      alert("Couldn't regenerate: " + error.message);
      setRegenerating(false);
      return;
    }
    setToken(newToken);
    setRegenerating(false);
  }

  if (loading) return null;

  const feedUrl = getFeedUrl(token);

  return (
    <div className="entity-form" style={{ marginBottom: 20 }}>
      <p className="field__label" style={{ marginBottom: 4 }}>📅 Your gig calendar</p>
      <p className="field__hint" style={{ marginBottom: 12 }}>
        Subscribe to your gigs in Apple Calendar, Google Calendar, or any calendar app.
        It updates automatically whenever your bookings change.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <button
          className="btn btn--primary btn--small"
          onClick={handleCopy}
          disabled={!feedUrl}
        >
          {copied ? '✓ Copied!' : '📋 Copy calendar link'}
        </button>

        <button
          className="btn btn--ghost btn--small"
          onClick={handleGoogleCalendar}
          disabled={!feedUrl}
        >
          {googleCopied ? '✓ Link copied — paste it in Google Calendar' : 'Add to Google Calendar ↗'}
        </button>

        {feedUrl && (
          <a
            href={feedUrl}
            download="my-gigs.ics"
            className="btn btn--ghost btn--small"
          >
            Download .ics
          </a>
        )}
      </div>

      <details>
        <summary className="field__hint" style={{ cursor: 'pointer', userSelect: 'none' }}>
          How to subscribe in your calendar app
        </summary>
        <ol className="field__hint" style={{ marginTop: 8, paddingLeft: 18, lineHeight: 1.8 }}>
          <li>Copy the calendar link using the button above</li>
          <li>
            <strong>Google Calendar:</strong> Click "Add to Google Calendar" — it copies your link and opens Google Calendar. Paste the link in the URL field and click Add
          </li>
          <li>
            <strong>iPhone/iPad:</strong> Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar → paste the link
          </li>
          <li>
            <strong>Mac:</strong> Calendar app → File → New Calendar Subscription → paste the link
          </li>
          <li>
            <strong>Outlook:</strong> Add calendar → Subscribe from web → paste the link
          </li>
        </ol>
      </details>

      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
        <button
          className="link-button"
          style={{ fontSize: 12, color: 'var(--text-muted)' }}
          onClick={handleRegenerate}
          disabled={regenerating}
        >
          {regenerating ? 'Regenerating…' : '🔄 Reset calendar link'}
        </button>
        <span className="field__hint" style={{ marginLeft: 8 }}>
          Use this if you want to revoke access to the current link
        </span>
      </div>
    </div>
  );
}

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
      
      {/* Header row: Title and Reset button on the same line to save vertical space */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <p className="field__label" style={{ marginBottom: 4 }}>📅 Your gig calendar</p>
          <p className="field__hint" style={{ marginBottom: 12, maxWidth: '90%' }}>
            Auto-updating gig schedule sync'd to your devices.
          </p>
        </div>
        
        <button
          className="link-button"
          style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}
          onClick={handleRegenerate}
          disabled={regenerating}
          title="Revoke access to your current link and create a new one"
        >
          {regenerating ? 'Regenerating...' : '🔄 Reset link'}
        </button>
      </div>
  
      {/* Buttons row: Wrapped in flex with wrap enabled */}
<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
  
  {/* webcal:// protocol automatically triggers Apple Calendar & Outlook to subscribe */}
  {feedUrl && (
    <a
      href={feedUrl.replace(/^https?:\/\//, 'webcal://')}
      className="btn btn--primary btn--small"
      style={{ 
        flex: '1 1 150px',
        width: 'auto',
        minWidth: '140px',
        textAlign: 'center',
        whiteSpace: 'nowrap'
      }}
    >
      Apple / Outlook ↗
    </a>
  )}

  <button
    className="btn btn--primary btn--small"
    onClick={handleGoogleCalendar}
    disabled={!feedUrl}
    style={{ 
      flex: '1 1 150px',
      width: 'auto',
      minWidth: '140px',
      whiteSpace: 'nowrap' 
    }}
  >
    {googleCopied ? '✓ Copied' : 'Google Calendar ↗'}
  </button>
</div>
  
      {/* Collapsible details for folks who still want manual fallback instructions */}
      <details>
        <summary className="field__hint" style={{ cursor: 'pointer', userSelect: 'none' }}>
          Manual setup instructions
        </summary>
        <button
          className="btn btn--ghost btn--small"
          onClick={handleCopy}
          disabled={!feedUrl}
        >
          {copied ? '✓ Copied!' : '📋 Copy link'}
        </button>
  
        {feedUrl && (
          <a
            href={feedUrl}
            download="my-gigs.ics"
            className="btn btn--ghost btn--small"
            title="Download static .ics file"
          >
            ⬇️ .ics
          </a>
        )}
        <ol className="field__hint" style={{ marginTop: 8, paddingLeft: 18, lineHeight: 1.6 }}>
          <li>
            <strong>Apple Devices / Outlook:</strong> Simply click "Subscribe (Apple / Outlook)" above. It will automatically open your calendar app and ask you to confirm.
          </li>
          <li>
            <strong>Google Calendar:</strong> Click "Google Calendar ↗". Once Google Calendar opens, paste your copied link into the URL field and click Add.
          </li>
          <li>
            <strong>Manual iPhone (iOS 18+):</strong> Settings → Apps → Calendar → Calendar Accounts → Add Account → Add Other Account → Add Subscribed Calendar.
          </li>
          <li>
            <strong>Manual iPhone (iOS 17 & older):</strong> Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar.
          </li>
          <li>
            <strong>Mac:</strong> Calendar app → File → New Calendar Subscription → paste the copied link.
          </li>
        </ol>
      </details>
    </div>
  );
}
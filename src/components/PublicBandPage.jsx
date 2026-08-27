import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { displayUrl } from '../utils/formatUrl.js';
import EnquiryForm from './EnquiryForm.jsx';

const AVAILABILITY_WEEKS = 24; // ~6 months of upcoming Saturdays

function nextSaturdays(count) {
  const dates = [];
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  // 6 = Saturday (Date.getDay(): 0 Sun .. 6 Sat)
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
  for (let i = 0; i < count; i++) {
    dates.push(new Date(d));
    d.setDate(d.getDate() + 7);
  }
  return dates;
}

// Deliberately not d.toISOString().slice(0,10) -- that converts to UTC
// first, so a local midnight in any UTC+ timezone (e.g. British Summer
// Time) rolls back to the previous day's date string, shifting every
// Saturday here one day earlier than the plain, timezone-free DATE
// strings Postgres returns for gig_date. Built from local components
// instead so both sides agree on the same calendar date.
function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

// Public, no-login page for a band that's opted in to a shareable booking
// page, reached via /band/<slug> (see App.jsx). Reads through the
// SECURITY DEFINER get_public_band_page/get_band_availability RPCs added
// alongside this feature, rather than any table directly — the anon role
// has no table grants on `bands` or `gigs`, only EXECUTE on these two
// functions, each already scoped to bands with public_enabled = true.
export default function PublicBandPage({ slug }) {
  const [page, setPage] = useState(null);
  const [busyDates, setBusyDates] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc('get_public_band_page', { p_slug: slug });
      if (cancelled) return;
      if (error || !data) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setPage(data);

      const saturdays = nextSaturdays(AVAILABILITY_WEEKS);
      const from = toISODate(saturdays[0]);
      const to = toISODate(saturdays[saturdays.length - 1]);
      const { data: busy } = await supabase.rpc('get_band_availability', {
        p_slug: slug,
        p_from: from,
        p_to: to,
      });
      if (!cancelled) setBusyDates(new Set(busy || []));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [slug]);

  useEffect(() => {
    if (!page) return;
    const prevTitle = document.title;
    document.title = page.name + ' — book them for your event';
    const meta = document.querySelector('meta[name="description"]');
    const prevDesc = meta?.content;
    if (meta) meta.content = (page.bio || page.name + ' — live music for weddings and events.').slice(0, 160);
    return () => {
      document.title = prevTitle;
      if (meta && prevDesc != null) meta.content = prevDesc;
    };
  }, [page]);

  if (loading) {
    return (
      <div className="enquiry-page">
        <p className="state-message">Loading…</p>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="enquiry-page">
        <div className="enquiry-card" style={{ padding: 32 }}>
          <p className="state-message state-message--error">
            This page isn't available.
          </p>
        </div>
      </div>
    );
  }

  const saturdays = nextSaturdays(AVAILABILITY_WEEKS);

  return (
    <div className="enquiry-page">
      <div style={{ width: '100%', maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 20 }}>

        <div
          className="enquiry-card"
          style={{ textAlign: 'center', '--doc-accent': page.doc_accent_colour || '#c8862e' }}
        >
          {page.logo_url ? (
            <img
              src={page.logo_url}
              alt={page.name}
              style={{ maxWidth: 160, maxHeight: 160, borderRadius: 12, margin: '0 auto 16px', display: 'block' }}
            />
          ) : (
            <div style={{ fontSize: 40, marginBottom: 8 }}>🎸</div>
          )}
          <h1 className="enquiry-card__title">{page.name}</h1>
          {page.genres?.length > 0 && (
            <p className="field__hint" style={{ marginTop: 4 }}>{page.genres.join(' · ')}</p>
          )}
          {page.bio && (
            <p style={{ marginTop: 16, textAlign: 'left', whiteSpace: 'pre-wrap' }}>{page.bio}</p>
          )}
          {(page.website_url || page.social_links?.length > 0) && (
            <p style={{ marginTop: 16 }}>
              {page.website_url && (
                <a href={page.website_url} target="_blank" rel="noopener noreferrer">{displayUrl(page.website_url)}</a>
              )}
              {page.social_links?.map((link, i) => (
                <span key={i}>
                  {(i > 0 || page.website_url) && ' · '}
                  <a href={link.url} target="_blank" rel="noopener noreferrer">{link.label}</a>
                </span>
              ))}
            </p>
          )}
        </div>

        <div className="enquiry-card">
          <p className="enquiry-section-label" style={{ marginTop: 0 }}>Upcoming Saturdays</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8 }}>
            {saturdays.map((d) => {
              const iso = toISODate(d);
              const free = !busyDates.has(iso);
              return (
                <div
                  key={iso}
                  style={{
                    border: '1px solid var(--line)',
                    borderRadius: 8,
                    padding: '8px 10px',
                    background: free ? 'var(--paper-raised)' : 'rgba(177,74,52,0.08)',
                  }}
                >
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>
                    {d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </div>
                  <div className="field__hint" style={{ color: free ? 'var(--teal)' : 'var(--rust)', marginTop: 2 }}>
                    {free ? 'Free' : 'Booked'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <EnquiryForm bandId={page.band_id} embedded />
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import SearchBox from './SearchBox.jsx';
import { useFuzzySearch } from '../hooks/useFuzzySearch.js';

const REQUESTED_KEY_PREFIX = 'gig_requests_made:';

function loadRequestedSet(token) {
  try {
    const raw = localStorage.getItem(REQUESTED_KEY_PREFIX + token);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function saveRequestedSet(token, set) {
  try {
    localStorage.setItem(REQUESTED_KEY_PREFIX + token, JSON.stringify([...set]));
  } catch {}
}

// Merges a realtime INSERT/UPDATE payload's row shape (raw song_requests
// columns) into the RPC's richer per-request shape (which also carries the
// joined song title/artist) -- falls back to whatever title/artist the row
// already had locally, since the realtime payload itself never has them.
function mergeRequest(prev, row) {
  const existing = prev.find((r) => r.id === row.id);
  const merged = {
    id: row.id,
    song_id: row.song_id,
    requested_text: row.requested_text,
    request_count: row.request_count,
    status: row.status,
    title: existing?.title,
    artist: existing?.artist,
  };
  const rest = prev.filter((r) => r.id !== row.id);
  return [...rest, merged].sort((a, b) => b.request_count - a.request_count);
}

// Public, no-login page for guests at a gig to request a song from the
// band's real setlist, reached via /requests/<token> (see App.jsx). Reads
// through get_gig_requests_page/submit_song_request rather than any table
// directly -- the anon role has no table grants beyond a narrow, time-
// boxed SELECT on song_requests itself (see the "QR-code dancefloor song
// requests" migration), used here only for the realtime subscription.
export default function PublicSongRequests({ token }) {
  const [page, setPage] = useState(null);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [requested, setRequested] = useState(() => loadRequestedSet(token));
  const [submittingId, setSubmittingId] = useState(null);
  const [customText, setCustomText] = useState('');
  const [customSubmitting, setCustomSubmitting] = useState(false);
  const [customError, setCustomError] = useState(null);
  const [customDone, setCustomDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc('get_gig_requests_page', { p_token: token });
      if (cancelled) return;
      if (error || !data) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setPage(data);
      setRequests(data.requests || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [token]);

  // Live "most requested" leaderboard -- the one genuinely new pattern
  // here (anon realtime), scoped by the RLS policy added alongside this
  // feature to gigs within their active request window only.
  useEffect(() => {
    if (!page?.gig_id) return;
    const channel = supabase
      .channel('song-requests-guest:' + page.gig_id)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'song_requests', filter: 'gig_id=eq.' + page.gig_id },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            setRequests((prev) => prev.filter((r) => r.id !== payload.old.id));
          } else {
            setRequests((prev) => mergeRequest(prev, payload.new));
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [page?.gig_id]);

  const { query, setQuery, results: filteredSongs } = useFuzzySearch(page?.songs || [], ['title', 'artist']);

  const requestCountBySongId = useMemo(() => {
    const map = new Map();
    for (const r of requests) {
      if (r.song_id) map.set(r.song_id, r.request_count);
    }
    return map;
  }, [requests]);

  async function requestSong(song) {
    if (submittingId) return;
    setSubmittingId(song.id);
    const { data, error } = await supabase.rpc('submit_song_request', {
      p_token: token,
      p_song_id: song.id,
    });
    setSubmittingId(null);
    if (error) return; // request page went stale mid-gig (window closed) -- fail quietly, nothing useful to retry
    const next = new Set(requested);
    next.add(song.id);
    setRequested(next);
    saveRequestedSet(token, next);
    if (data?.request_count) {
      setRequests((prev) => {
        const existing = prev.find((r) => r.song_id === song.id);
        if (existing) return prev.map((r) => (r.song_id === song.id ? { ...r, request_count: data.request_count } : r));
        return [...prev, { id: data.id, song_id: song.id, title: song.title, artist: song.artist, request_count: data.request_count, status: 'pending' }];
      });
    }
  }

  async function submitCustom(e) {
    e.preventDefault();
    const text = customText.trim();
    if (!text) return;
    setCustomSubmitting(true);
    setCustomError(null);
    const { error } = await supabase.rpc('submit_song_request', {
      p_token: token,
      p_requested_text: text,
    });
    setCustomSubmitting(false);
    if (error) {
      setCustomError("Couldn't send that request — please try again.");
      return;
    }
    setCustomText('');
    setCustomDone(true);
    setTimeout(() => setCustomDone(false), 4000);
  }

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
          <p className="state-message state-message--error">This page isn't available.</p>
        </div>
      </div>
    );
  }

  const topRequests = [...requests].filter((r) => r.status === 'pending').sort((a, b) => b.request_count - a.request_count).slice(0, 10);

  return (
    <div className="enquiry-page">
      <div style={{ width: '100%', maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 20 }}>

        <div className="enquiry-card">
          <div className="band-page-hero">
            {page.logo_url ? (
              <img src={page.logo_url} alt={page.band_name} className="band-page-logo" />
            ) : (
              <div className="band-page-fallback-icon">🎶</div>
            )}
            <h1 className="enquiry-card__title">Request a song</h1>
            <p className="band-page-genres">for {page.band_name} — tap a song below and it goes straight to the band</p>
          </div>
        </div>

        {topRequests.length > 0 && (
          <div className="enquiry-card">
            <div className="band-page-availability">
              <p className="band-page-availability__title">Most requested tonight</p>
              <div className="song-request-leaderboard">
                {topRequests.map((r) => (
                  <div key={r.id} className="song-request-leaderboard__row">
                    <span className="song-request-leaderboard__song">
                      {r.title || r.requested_text}
                      {r.artist && <span className="song-request-leaderboard__artist"> — {r.artist}</span>}
                    </span>
                    <span className="song-request-leaderboard__count">{r.request_count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="enquiry-card">
          <div className="band-page-availability">
            <p className="band-page-availability__title">Pick a song</p>
            <SearchBox
              value={query}
              onChange={setQuery}
              placeholder="Search the setlist…"
              resultCount={filteredSongs.length}
              totalCount={page.songs?.length || 0}
            />
            <div className="song-request-list">
              {filteredSongs.map((song) => {
                const already = requested.has(song.id);
                const count = requestCountBySongId.get(song.id);
                return (
                  <button
                    key={song.id}
                    type="button"
                    className={'song-request-list__item' + (already ? ' song-request-list__item--done' : '')}
                    onClick={() => requestSong(song)}
                    disabled={already || submittingId === song.id}
                  >
                    <span className="song-request-list__title">
                      {song.title}
                      {song.artist && <span className="song-request-list__artist"> — {song.artist}</span>}
                    </span>
                    <span className="song-request-list__action">
                      {already ? 'Requested ✓' : submittingId === song.id ? '…' : count ? 'Request (' + count + ')' : 'Request'}
                    </span>
                  </button>
                );
              })}
              {filteredSongs.length === 0 && (
                <p className="state-message">No songs match "{query}".</p>
              )}
            </div>

            <form onSubmit={submitCustom} className="song-request-custom">
              <label className="field">
                <span className="field__label">Can't find it? Request anything</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    value={customText}
                    onChange={(e) => setCustomText(e.target.value.slice(0, 150))}
                    placeholder="Song and artist…"
                    style={{ flex: 1 }}
                  />
                  <button type="submit" className="btn btn--primary btn--small" style={{ width: 'auto' }} disabled={customSubmitting || !customText.trim()}>
                    {customSubmitting ? '…' : 'Send'}
                  </button>
                </div>
              </label>
              {customDone && <p className="form-success" style={{ marginTop: 6 }}>Request sent!</p>}
              {customError && <p className="form-error">{customError}</p>}
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

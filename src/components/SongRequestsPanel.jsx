import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useCurrentProfile } from '../context/ProfileContext.jsx';
import qrcode from '../utils/qrcode.js';
import { printHtmlDocument, esc, fontFaceCss } from '../utils/printHtml.js';
import { notify } from '../utils/toastService.js';
import { formatShortDate } from '../utils/formatDate.js';

// Matches the window get_gig_requests_page/submit_song_request/
// song_requests_anon_select all check server-side (gig_date-1..gig_date)
// -- opens the day before the gig (covers one still running past
// midnight) and closes at the end of the gig's own calendar day. Pure
// date arithmetic, not timezone-sensitive the way a Date-object diff
// would be, since gig_date arrives as a plain "YYYY-MM-DD" string.
function requestWindow(gigDate) {
  if (!gigDate) return null;
  const [y, m, d] = gigDate.split('-').map(Number);
  const opens = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
  return { opens, closes: gigDate };
}

// The song_requests table only stores song_id -- title/artist live on the
// joined songs row. The initial select joins it directly; a request that
// arrives afterwards via Realtime only ever carries the raw row (no join
// support there), so a not-yet-seen song_id is resolved with one small
// on-demand lookup instead of preloading the whole setlist.
function flattenSongJoin(row) {
  const { songs, ...rest } = row;
  return { ...rest, song_title: songs?.title ?? rest.song_title, song_artist: songs?.artist ?? rest.song_artist };
}

function sortRequests(list) {
  return [...list].sort((a, b) => {
    if (a.status === 'pending' && b.status !== 'pending') return -1;
    if (b.status === 'pending' && a.status !== 'pending') return 1;
    if (b.request_count !== a.request_count) return b.request_count - a.request_count;
    return new Date(b.updated_at) - new Date(a.updated_at);
  });
}

function buildTableTentHTML(band, url, dataUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Song requests — ${esc(band?.name || '')}</title>
<style>
  ${fontFaceCss()}
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: white; font-family: 'Inter', sans-serif; color: #1a1a1a; }
  .page {
    width: 210mm;
    height: 297mm;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 20mm;
  }
  .eyebrow { font-family: 'Space Grotesk', sans-serif; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; font-size: 14pt; color: #c8862e; margin-bottom: 6mm; }
  h1 { font-family: 'Space Grotesk', sans-serif; font-size: 32pt; margin: 0 0 10mm; }
  img { width: 90mm; height: 90mm; }
  .sub { font-size: 13pt; color: #4a4335; margin-top: 10mm; max-width: 130mm; }
  .url { font-family: 'IBM Plex Mono', monospace; font-size: 10pt; color: #7a7261; margin-top: 6mm; word-break: break-all; }
</style>
</head>
<body>
  <div class="page">
    <div class="eyebrow">🎶 Request a song</div>
    <h1>${esc(band?.name || 'Scan to request')}</h1>
    <img src="${dataUrl}" alt="QR code"/>
    <p class="sub">Scan with your phone camera to pick a song from tonight's setlist — it goes straight to the band.</p>
    <p class="url">${esc(url)}</p>
  </div>
</body>
</html>`;
}

// Live, band-facing view of a gig's song requests, plus the QR code/print
// controls to put it in front of guests. Realtime subscription mirrors
// GigMessages.jsx's exact recipe (channel scoped by gig_id, cleaned up via
// supabase.removeChannel on unmount) -- RLS (song_requests_select) is what
// actually decides who receives events, this just opens the channel.
export default function SongRequestsPanel({ gig }) {
  const { isAdmin, ledBandIds } = useCurrentProfile();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showQr, setShowQr] = useState(false);

  const canManage = isAdmin || ledBandIds.includes(gig.band_id);
  const url = window.location.origin + '/requests/' + gig.requests_token;

  const dataUrl = useMemo(() => {
    if (!showQr) return null;
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    return qr.createDataURL(8, 8);
  }, [showQr, url]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('song_requests')
        .select('*, songs(title, artist)')
        .eq('gig_id', gig.id);
      if (!cancelled) {
        setRequests(sortRequests((data || []).map(flattenSongJoin)));
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [gig.id]);

  useEffect(() => {
    const channel = supabase
      .channel('song-requests-band:' + gig.id)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'song_requests', filter: 'gig_id=eq.' + gig.id },
        async (payload) => {
          if (payload.eventType === 'DELETE') {
            setRequests((prev) => prev.filter((r) => r.id !== payload.old.id));
            return;
          }
          let row = payload.new;
          // Only a genuinely new row needs a title lookup -- an UPDATE
          // (a repeat-tap count bump, or a status change) merges against
          // the already-known title in `prev` state below instead.
          if (payload.eventType === 'INSERT' && row.song_id) {
            const { data: song } = await supabase.from('songs').select('title, artist').eq('id', row.song_id).maybeSingle();
            row = { ...row, song_title: song?.title, song_artist: song?.artist };
          }
          setRequests((prev) => {
            const existing = prev.find((r) => r.id === row.id);
            const rest = prev.filter((r) => r.id !== row.id);
            return sortRequests([...rest, { ...existing, ...row }]);
          });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [gig.id]);

  async function updateStatus(id, status) {
    const { error } = await supabase.from('song_requests').update({ status }).eq('id', id);
    if (error) notify("Couldn't update that request: " + error.message);
  }

  function handlePrint() {
    if (!dataUrl) return;
    printHtmlDocument(buildTableTentHTML({ name: gig.bands?.name }, url, dataUrl));
  }

  if (requests.length === 0 && !showQr && loading) return null;

  const pendingCount = requests.filter((r) => r.status === 'pending').length;
  const win = requestWindow(gig.gig_date);

  return (
    <div className="roster-section">
      <h3 className="roster-section__title">Song requests {pendingCount > 0 && <span className="field__hint">({pendingCount} new)</span>}</h3>
      <p className="field__hint" style={{ marginBottom: 4 }}>
        A QR code guests scan at the gig to request a song from tonight's setlist — no app, no login.
      </p>
      {win && (
        <p className="field__hint" style={{ marginBottom: 12 }}>
          Live from <strong>{formatShortDate(win.opens)}</strong> to <strong>{formatShortDate(win.closes)}</strong> — opens the day
          before so it still works if the gig runs past midnight. Outside that window the code just shows "not available".
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <button type="button" className="btn btn--ghost btn--small" onClick={() => setShowQr((v) => !v)}>
          {showQr ? 'Hide QR code' : 'Show QR code'}
        </button>
        {showQr && (
          <button type="button" className="btn btn--ghost btn--small" onClick={handlePrint}>
            Print table tent
          </button>
        )}
      </div>

      {showQr && dataUrl && (
        <div style={{ textAlign: 'center', marginBottom: 16, padding: 16, background: 'var(--paper-raised)', border: '1px solid var(--line)', borderRadius: 10 }}>
          <img src={dataUrl} alt="QR code for song requests" style={{ width: 160, height: 160 }} />
          <p className="field__hint" style={{ marginTop: 8, fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>{url}</p>
          {win && (
            <p className="field__hint" style={{ marginTop: 4 }}>
              Valid {formatShortDate(win.opens)} – {formatShortDate(win.closes)}
            </p>
          )}
        </div>
      )}

      {requests.length === 0 ? (
        <p className="field__hint">No requests yet.</p>
      ) : (
        <div className="song-request-list">
          {requests.map((r) => (
            <div key={r.id} className={'song-request-list__item' + (r.status !== 'pending' ? ' song-request-list__item--done' : '')} style={{ cursor: 'default' }}>
              <span className="song-request-list__title">
                {r.song_title || r.requested_text}
                <span className="field__hint" style={{ marginLeft: 8 }}>×{r.request_count}</span>
              </span>
              {canManage && r.status === 'pending' && (
                <span style={{ display: 'flex', gap: 8, flex: 'none' }}>
                  <button type="button" className="link-button" onClick={() => updateStatus(r.id, 'played')}>Played</button>
                  <button type="button" className="link-button link-button--danger" onClick={() => updateStatus(r.id, 'dismissed')}>Dismiss</button>
                </span>
              )}
              {r.status !== 'pending' && <span className="song-request-list__action">{r.status}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

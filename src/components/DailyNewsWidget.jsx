import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

// Purely an engagement hook -- gives people a reason to open the app even
// on a day with no gig activity. Populated by the daily-news-digest Edge
// Function (scheduled ~6am UK), never written from the client.
const LAST_SEEN_KEY = 'news_last_seen_at';

function timeAgo(iso) {
  if (!iso) return '';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + 'h ago';
  return Math.floor(hours / 24) + 'd ago';
}

export default function DailyNewsWidget() {
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let active = true;
    supabase
      .from('news_articles')
      .select('id, title, summary, url, source, published_at')
      .order('published_at', { ascending: false })
      .limit(5)
      .then(({ data }) => {
        if (!active) return;
        const list = data || [];
        setArticles(list);
        setLoading(false);

        let lastSeen = 0;
        try {
          lastSeen = Number(localStorage.getItem(LAST_SEEN_KEY) || 0);
        } catch {}
        setUnreadCount(list.filter((a) => a.published_at && new Date(a.published_at).getTime() > lastSeen).length);
      });
    return () => {
      active = false;
    };
  }, []);

  function markSeen() {
    if (unreadCount === 0) return;
    try {
      localStorage.setItem(LAST_SEEN_KEY, String(Date.now()));
    } catch {}
    setUnreadCount(0);
  }

  // No visible gap on the rare day the digest comes back empty -- just
  // don't render the section, same as any other "nothing here" list in
  // this app.
  if (loading || articles.length === 0) return null;

  return (
    <div className="day-sheet__section" onClick={markSeen}>
      <h3 className="day-sheet__section-title">
        🎵 Today's music news
        {unreadCount > 0 && (
          <span className="status-tag status-tag--confirmed" style={{ marginLeft: 8 }}>
            {unreadCount} new
          </span>
        )}
      </h3>
      <ul className="simple-list">
        {articles.map((a) => (
          <li className="simple-list__item" key={a.id}>
            <a
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              className="simple-list__row"
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              <div>
                <span className="simple-list__title">{a.title}</span>
                <span className="simple-list__subtitle">
                  {a.source || 'Unknown source'} · {timeAgo(a.published_at)}
                  {a.summary ? ' — ' + a.summary : ''}
                </span>
              </div>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

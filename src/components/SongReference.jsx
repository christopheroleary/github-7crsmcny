// Shared by GigSetlist (per-gig setlist rows) and SongsList (the admin
// repertoire) so both show the same "Listen"/"Lyrics" expandable content
// for a song, rather than maintaining two copies of the YouTube/Spotify
// embed-matching logic.
export function ReferencePlayer({ url }) {
  if (!url) return null;
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
  if (ytMatch) {
    return (
      <div className="reference-player">
        <iframe
          width="100%"
          height="200"
          src={'https://www.youtube.com/embed/' + ytMatch[1]}
          title="Song reference"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }
  const spotifyMatch = url.match(/open\.spotify\.com\/(track|album|playlist)\/([\w]+)/);
  if (spotifyMatch) {
    return (
      <div className="reference-player">
        <iframe
          width="100%"
          height="152"
          src={'https://open.spotify.com/embed/' + spotifyMatch[1] + '/' + spotifyMatch[2]}
          title="Song reference"
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        />
      </div>
    );
  }
  return (
    <p className="state-message" style={{ textAlign: 'left', padding: '8px 0' }}>
      <a href={url} target="_blank" rel="noopener noreferrer">Open reference link ↗</a>
    </p>
  );
}

export function LyricsView({ text }) {
  if (!text) return null;
  const lines = text.split('\n');
  return (
    <div className="lyrics-view">
      {lines.map((line, i) =>
        /^\[.+\]$/.test(line.trim()) ? (
          <p key={i} className="lyrics-view__section">{line}</p>
        ) : (
          <p key={i} className="lyrics-view__line">{line || ' '}</p>
        )
      )}
    </div>
  );
}

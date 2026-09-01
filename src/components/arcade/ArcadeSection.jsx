import { lazy, Suspense, useState } from 'react';
import { useCurrentProfile } from '../../context/ProfileContext.jsx';
import InfoTooltip from '../InfoTooltip.jsx';
import { useArcade, DAILY_LIVES } from '../../hooks/useArcade.js';
import { notify } from '../../utils/toastService.js';
import { isLikelyOfflineError } from '../../utils/networkError.js';

// Lazy-loaded so the game code (canvas logic, word lists, etc.) only ever
// downloads for someone who actually opens the arcade -- everyone else's
// bundle stays exactly as small as before this feature existed.
const SnakeGame = lazy(() => import('./SnakeGame.jsx'));
const MusicWordleGame = lazy(() => import('./MusicWordleGame.jsx'));
const InstrumentTicTacToeGame = lazy(() => import('./InstrumentTicTacToeGame.jsx'));

const GAMES = [
  { key: 'snake', label: 'Snake', icon: '🐍', Component: SnakeGame },
  { key: 'music_wordle', label: 'Music Wordle', icon: '🔤', Component: MusicWordleGame },
  { key: 'instrument_tictactoe', label: 'Noughts & Crosses', icon: '🎸', Component: InstrumentTicTacToeGame },
];

const COMING_SOON = [
  { key: 'dual_pong', label: 'Dual Pong', icon: '🏓' },
  { key: 'battle_tiles', label: 'Battle Tiles', icon: '⚔️' },
  { key: 'guess_intro', label: 'Guess the Intro', icon: '🎧' },
];

function LiveDots({ livesLeft }) {
  if (livesLeft === Infinity) {
    return <span title="Admins have unlimited goes">♾️</span>;
  }
  return (
    <span style={{ display: 'inline-flex', gap: 3 }} aria-label={livesLeft + ' of ' + DAILY_LIVES + ' lives left today'}>
      {Array.from({ length: DAILY_LIVES }).map((_, i) => (
        <span key={i} style={{ opacity: i < livesLeft ? 1 : 0.25 }}>❤️</span>
      ))}
    </span>
  );
}

export default function ArcadeSection({ gigId }) {
  const { profile, isAdmin } = useCurrentProfile();
  const { loading, livesLeft, personalBests, submitScore, gigLeaderboardFor } = useArcade(gigId, profile?.id, isAdmin);
  const [openGame, setOpenGame] = useState(null);
  const [lastScore, setLastScore] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleGameOver(score) {
    setSubmitting(true);
    const { error } = await submitScore(openGame, score);
    setSubmitting(false);
    if (error) {
      if (error.message.includes('No lives left')) {
        // A game's own "play again" restarts itself directly, bypassing the
        // picker-level lives check below -- the server-side check in
        // record_arcade_play is the real enforcement either way, but bounce
        // back to the picker so it's obvious why nothing happened, instead
        // of leaving them stuck replaying rounds that can never save.
        notify("You're out of lives for today — come back tomorrow.");
        setOpenGame(null);
        return;
      } else if (isLikelyOfflineError(error)) {
        notify("You're offline — this score wasn't saved. It won't count against tonight's leaderboard or your lives; try again once you're back online.");
      } else {
        notify("Couldn't save score: " + error.message);
      }
      return;
    }
    setLastScore(score);
  }

  function openGamePicker(key) {
    if (livesLeft <= 0) {
      notify("You're out of lives for today — come back tomorrow.");
      return;
    }
    setLastScore(null);
    setOpenGame(key);
  }

  if (!profile) return null;

  const activeGame = GAMES.find((g) => g.key === openGame);

  return (
    <div className="day-sheet__section" id="gig-section-arcade">
      <h3 className="roster-section__title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          🎮 Break-time games
          <InfoTooltip text={`${DAILY_LIVES} goes a day, shared across every game. Compete against whoever else is on this gig's roster tonight.`} />
        </span>
        {!loading && <LiveDots livesLeft={livesLeft} />}
      </h3>

      {!activeGame ? (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {GAMES.map((g) => (
              <button
                key={g.key}
                type="button"
                onClick={() => openGamePicker(g.key)}
                className="btn btn--ghost btn--small"
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '10px 16px', height: 'auto' }}
              >
                <span style={{ fontSize: 22 }}>{g.icon}</span>
                <span>{g.label}</span>
                {personalBests[g.key] != null && (
                  <span className="field__hint" style={{ fontSize: 11 }}>Best: {personalBests[g.key]}</span>
                )}
              </button>
            ))}
            {COMING_SOON.map((g) => (
              <div
                key={g.key}
                title="Coming soon"
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '10px 16px', opacity: 0.4 }}
              >
                <span style={{ fontSize: 22 }}>{g.icon}</span>
                <span style={{ fontSize: 13 }}>{g.label}</span>
                <span className="field__hint" style={{ fontSize: 11 }}>Soon</span>
              </div>
            ))}
          </div>

          {gigId && GAMES.some((g) => gigLeaderboardFor(g.key).length > 0) && (
            <div style={{ marginTop: 16 }}>
              <p className="field__label" style={{ marginBottom: 6 }}>Tonight's leaderboard</p>
              {GAMES.map((g) => {
                const board = gigLeaderboardFor(g.key);
                if (board.length === 0) return null;
                return (
                  <div key={g.key} style={{ marginBottom: 10 }}>
                    <span className="field__hint" style={{ fontWeight: 600 }}>{g.icon} {g.label}</span>
                    <ol style={{ margin: '4px 0 0', paddingLeft: 20, fontSize: 13 }}>
                      {board.slice(0, 5).map((row) => (
                        <li key={row.profile_id} style={{ fontWeight: row.profile_id === profile.id ? 700 : 400 }}>
                          {row.name} — {row.score}
                        </li>
                      ))}
                    </ol>
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <div>
          <button type="button" className="link-button" style={{ marginBottom: 10 }} onClick={() => setOpenGame(null)}>
            ← Back to games
          </button>
          <Suspense fallback={<p className="field__hint">Loading game…</p>}>
            <activeGame.Component onGameOver={handleGameOver} />
          </Suspense>
          {lastScore != null && !submitting && (
            <p className="field__hint" style={{ marginTop: 10 }}>
              Score saved: {lastScore}. {livesLeft === Infinity ? 'Unlimited goes as admin.' : livesLeft > 0 ? livesLeft + ' more go' + (livesLeft === 1 ? '' : 'es') + ' today.' : "That's your lot for today — see you tomorrow."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

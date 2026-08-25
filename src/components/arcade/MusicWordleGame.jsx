import { useEffect, useState, useCallback } from 'react';
import { MUSIC_WORDLE_WORDS } from '../../utils/musicWordleWords.js';

const MAX_GUESSES = 6;
const WORD_LEN = 5;
const KEY_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];

function pickWord() {
  return MUSIC_WORDLE_WORDS[Math.floor(Math.random() * MUSIC_WORDLE_WORDS.length)];
}

// Wordle's own letter-status algorithm: exact matches first, then leftover
// letters (accounting for how many of that letter remain unmatched) get
// "present", everything else "absent" -- a naive per-letter check would
// wrongly mark every occurrence of a repeated letter as present/correct.
function scoreGuess(guess, answer) {
  const result = new Array(WORD_LEN).fill('absent');
  const remaining = {};
  for (let i = 0; i < WORD_LEN; i++) {
    if (guess[i] === answer[i]) result[i] = 'correct';
    else remaining[answer[i]] = (remaining[answer[i]] || 0) + 1;
  }
  for (let i = 0; i < WORD_LEN; i++) {
    if (result[i] === 'correct') continue;
    if (remaining[guess[i]] > 0) {
      result[i] = 'present';
      remaining[guess[i]] -= 1;
    }
  }
  return result;
}

const STATUS_COLOUR = {
  correct: '#2f7d4f',
  present: '#c8862e',
  absent: 'var(--text-muted)',
  unknown: 'var(--paper-raised)',
};

export default function MusicWordleGame({ onGameOver }) {
  const [answer] = useState(pickWord);
  const [guesses, setGuesses] = useState([]);
  const [current, setCurrent] = useState('');
  const [status, setStatus] = useState('playing'); // playing | won | lost
  const [shake, setShake] = useState(false);

  const finish = useCallback((won, attemptsUsed) => {
    // Fewer guesses = higher score; losing still banks a small consolation
    // score so a rough day at Wordle doesn't feel like a wasted life.
    const score = won ? Math.max(20, (MAX_GUESSES - attemptsUsed + 1) * 20) : 10;
    onGameOver(score);
  }, [onGameOver]);

  const submitGuess = useCallback(() => {
    if (current.length !== WORD_LEN) {
      setShake(true);
      setTimeout(() => setShake(false), 400);
      return;
    }
    if (!MUSIC_WORDLE_WORDS.includes(current)) {
      setShake(true);
      setTimeout(() => setShake(false), 400);
      return;
    }
    const nextGuesses = [...guesses, current];
    setGuesses(nextGuesses);
    setCurrent('');
    if (current === answer) {
      setStatus('won');
      finish(true, nextGuesses.length);
    } else if (nextGuesses.length >= MAX_GUESSES) {
      setStatus('lost');
      finish(false, nextGuesses.length);
    }
  }, [current, guesses, answer, finish]);

  const pressKey = useCallback((key) => {
    if (status !== 'playing') return;
    if (key === 'ENTER') { submitGuess(); return; }
    if (key === 'BACK') { setCurrent((c) => c.slice(0, -1)); return; }
    if (/^[A-Z]$/.test(key) && current.length < WORD_LEN) setCurrent((c) => c + key);
  }, [status, current, submitGuess]);

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Enter') pressKey('ENTER');
      else if (e.key === 'Backspace') pressKey('BACK');
      else if (/^[a-zA-Z]$/.test(e.key)) pressKey(e.key.toUpperCase());
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pressKey]);

  // Best-known status per letter across all guesses so far, for colouring
  // the on-screen keyboard (a letter marked "correct" once should never
  // downgrade back to "present"/"absent" from a later, less-lucky guess).
  const letterStatus = {};
  const rank = { correct: 3, present: 2, absent: 1 };
  guesses.forEach((g) => {
    const result = scoreGuess(g, answer);
    g.split('').forEach((letter, i) => {
      if (!letterStatus[letter] || rank[result[i]] > rank[letterStatus[letter]]) {
        letterStatus[letter] = result[i];
      }
    });
  });

  const rows = [...guesses, ...(status === 'playing' ? [current] : []), ...Array(Math.max(0, MAX_GUESSES - guesses.length - (status === 'playing' ? 1 : 0))).fill('')];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} className={shake ? 'arcade-shake' : ''}>
        {rows.slice(0, MAX_GUESSES).map((row, rowIdx) => {
          const isSubmitted = rowIdx < guesses.length;
          const result = isSubmitted ? scoreGuess(row, answer) : null;
          return (
            <div key={rowIdx} style={{ display: 'flex', gap: 6 }}>
              {Array.from({ length: WORD_LEN }).map((_, i) => (
                <div
                  key={i}
                  style={{
                    width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: '2px solid var(--line)', borderRadius: 6, fontWeight: 700, fontSize: 18,
                    background: isSubmitted ? STATUS_COLOUR[result[i]] : 'var(--paper)',
                    color: isSubmitted ? '#fff' : 'var(--ink)',
                    textTransform: 'uppercase',
                  }}
                >
                  {row[i] || ''}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {status !== 'playing' && (
        <p className="field__hint" style={{ fontWeight: 700 }}>
          {status === 'won' ? '🎉 Got it!' : 'The word was ' + answer}
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%', maxWidth: 340 }}>
        {KEY_ROWS.map((row, i) => (
          <div key={i} style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
            {i === 2 && (
              <button type="button" className="btn btn--ghost btn--small" style={{ padding: '6px 8px' }} onClick={() => pressKey('ENTER')} disabled={status !== 'playing'}>
                Enter
              </button>
            )}
            {row.split('').map((letter) => (
              <button
                key={letter}
                type="button"
                onClick={() => pressKey(letter)}
                disabled={status !== 'playing'}
                style={{
                  minWidth: 26, padding: '8px 0', border: 'none', borderRadius: 5, fontWeight: 600, fontSize: 12,
                  background: STATUS_COLOUR[letterStatus[letter] || 'unknown'],
                  color: letterStatus[letter] ? '#fff' : 'var(--ink)',
                  cursor: status === 'playing' ? 'pointer' : 'default',
                }}
              >
                {letter}
              </button>
            ))}
            {i === 2 && (
              <button type="button" className="btn btn--ghost btn--small" style={{ padding: '6px 8px' }} onClick={() => pressKey('BACK')} disabled={status !== 'playing'}>
                ⌫
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

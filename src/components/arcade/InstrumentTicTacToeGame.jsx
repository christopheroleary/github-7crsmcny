import { useState } from 'react';

const INSTRUMENTS = [
  { key: 'guitar', icon: '🎸' },
  { key: 'drums', icon: '🥁' },
  { key: 'mic', icon: '🎤' },
  { key: 'sax', icon: '🎷' },
  { key: 'keys', icon: '🎹' },
  { key: 'trumpet', icon: '🎺' },
];

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

function winnerOf(board) {
  for (const [a, b, c] of LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  return board.every(Boolean) ? 'draw' : null;
}

// Not full minimax -- deliberately beatable so it's a fun break-time game,
// not an unwinnable wall. Priority: take a winning move, else block the
// player's winning move, else take the centre, else a random open square.
function pickAiMove(board, ai, human) {
  for (const player of [ai, human]) {
    for (const line of LINES) {
      const values = line.map((i) => board[i]);
      const empties = line.filter((i) => !board[i]);
      if (empties.length === 1 && values.filter((v) => v === player).length === 2) {
        return empties[0];
      }
    }
  }
  if (!board[4]) return 4;
  const open = board.map((v, i) => (v ? null : i)).filter((i) => i != null);
  return open[Math.floor(Math.random() * open.length)];
}

export default function InstrumentTicTacToeGame({ onGameOver }) {
  const [playerInstrument, setPlayerInstrument] = useState(null);
  const [aiInstrument, setAiInstrument] = useState(null);
  const [board, setBoard] = useState(Array(9).fill(null));
  const [result, setResult] = useState(null); // null | 'win' | 'lose' | 'draw'
  const [finished, setFinished] = useState(false);

  function startGame(icon) {
    const remaining = INSTRUMENTS.filter((i) => i.icon !== icon);
    const ai = remaining[Math.floor(Math.random() * remaining.length)].icon;
    setPlayerInstrument(icon);
    setAiInstrument(ai);
    setBoard(Array(9).fill(null));
    setResult(null);
    setFinished(false);
  }

  function finishWith(outcome) {
    setResult(outcome);
    if (finished) return;
    setFinished(true);
    const score = outcome === 'win' ? 100 : outcome === 'draw' ? 50 : 20;
    onGameOver(score);
  }

  function handleCellClick(i) {
    if (finished || board[i] || result) return;
    const next = [...board];
    next[i] = playerInstrument;
    setBoard(next);

    const w = winnerOf(next);
    if (w === playerInstrument) { finishWith('win'); return; }
    if (w === 'draw') { finishWith('draw'); return; }

    setTimeout(() => {
      const aiMove = pickAiMove(next, aiInstrument, playerInstrument);
      const afterAi = [...next];
      afterAi[aiMove] = aiInstrument;
      setBoard(afterAi);
      const w2 = winnerOf(afterAi);
      if (w2 === aiInstrument) finishWith('lose');
      else if (w2 === 'draw') finishWith('draw');
    }, 350);
  }

  if (!playerInstrument) {
    return (
      <div style={{ textAlign: 'center' }}>
        <p className="field__hint" style={{ marginBottom: 12 }}>Choose your instrument</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          {INSTRUMENTS.map((inst) => (
            <button
              key={inst.key}
              type="button"
              onClick={() => startGame(inst.icon)}
              style={{ fontSize: 32, padding: 12, borderRadius: 10, border: '1px solid var(--line)', background: 'var(--paper)', cursor: 'pointer' }}
              aria-label={inst.key}
            >
              {inst.icon}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
      <p className="field__hint">
        You're {playerInstrument} · Opponent is {aiInstrument}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 64px)', gap: 6 }}>
        {board.map((cell, i) => (
          <button
            key={i}
            type="button"
            onClick={() => handleCellClick(i)}
            disabled={Boolean(cell) || finished}
            style={{
              width: 64, height: 64, fontSize: 28, borderRadius: 8,
              border: '1px solid var(--line)', background: 'var(--paper-raised)',
              cursor: cell || finished ? 'default' : 'pointer',
            }}
          >
            {cell || ''}
          </button>
        ))}
      </div>
      {result && (
        <p className="field__hint" style={{ fontWeight: 700 }}>
          {result === 'win' ? '🎉 You win!' : result === 'draw' ? "It's a draw" : 'Opponent wins'}
        </p>
      )}
    </div>
  );
}

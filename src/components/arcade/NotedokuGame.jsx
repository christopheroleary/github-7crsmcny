import { useEffect, useRef, useState } from 'react';

// A faithful "one piece per coloured region, one per row, one per column,
// no two touching (even diagonally)" logic puzzle -- the same genre as
// Oakever's Meowdoku (and LinkedIn's Queens before it), reskinned with
// music instruments instead of cats. Each region gets both its own colour
// AND its own instrument icon, doubling as a second, colour-independent
// way to tell regions apart.
const MAX_MISTAKES = 3;
const DIFFICULTIES = [
  { key: 'easy', label: 'Easy', size: 6 },
  { key: 'medium', label: 'Medium', size: 7 },
  { key: 'hard', label: 'Hard', size: 8 },
];
const INSTRUMENT_ICONS = ['🎸', '🥁', '🎤', '🎷', '🎹', '🎺', '🎻', '🪕'];
const REGION_COLORS = ['#f4b183', '#a9d18e', '#8fbcdb', '#f4a6c6', '#c9a0dc', '#f6e27a', '#e8846b', '#7fd1c9'];

function vibrate(pattern) {
  try { navigator.vibrate?.(pattern); } catch { /* iOS Safari has no Vibration API -- fine to no-op */ }
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// One valid, fully-solved board: exactly one piece per row/column, and no
// two pieces in adjacent rows sit within one column of each other (the
// only pairing that could ever be diagonally/orthogonally touching, since
// two pieces two-or-more rows apart can never touch regardless of column).
function generateSolution(n) {
  function backtrack(row, usedCols, placement) {
    if (row === n) return [...placement];
    for (const c of shuffle([...Array(n).keys()])) {
      if (usedCols.has(c)) continue;
      if (row > 0 && Math.abs(c - placement[row - 1]) <= 1) continue;
      usedCols.add(c);
      placement.push(c);
      const result = backtrack(row + 1, usedCols, placement);
      if (result) return result;
      placement.pop();
      usedCols.delete(c);
    }
    return null;
  }
  return backtrack(0, new Set(), []);
}

// Grows n regions outward from the planted solution's cells via a
// randomised multi-source flood fill, giving irregular, organic region
// shapes (the genre's signature look) rather than neat squares -- every
// cell ends up claimed since the grid is fully connected by 4-neighbour
// adjacency and every claimed cell keeps offering its unclaimed
// neighbours to the frontier.
function generateRegions(n, solution) {
  const region = Array.from({ length: n }, () => new Array(n).fill(-1));
  const frontier = [];
  solution.forEach((col, row) => {
    region[row][col] = row;
    frontier.push([row, col]);
  });
  let claimed = n;
  while (claimed < n * n) {
    const order = shuffle(frontier);
    let grew = false;
    for (const [r, c] of order) {
      if (claimed >= n * n) break;
      const regionId = region[r][c];
      const options = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]
        .filter(([rr, cc]) => rr >= 0 && rr < n && cc >= 0 && cc < n && region[rr][cc] === -1);
      if (options.length === 0) continue;
      const [nr, nc] = options[Math.floor(Math.random() * options.length)];
      region[nr][nc] = regionId;
      frontier.push([nr, nc]);
      claimed++;
      grew = true;
    }
    if (!grew) break; // every frontier cell is boxed in -- shouldn't happen on a connected grid, but avoid ever hanging
  }
  return region;
}

// Counts solutions up to `cap` (2 is enough to know "unique or not" without
// exploring the whole search space) -- same placement rules as
// generateSolution, but region membership is now a fourth constraint
// alongside row/column/adjacency.
function countSolutions(n, region, cap) {
  let count = 0;
  const colUsed = new Array(n).fill(false);
  const regionUsed = new Array(n).fill(false);
  const placement = new Array(n).fill(-1);

  function backtrack(row) {
    if (count >= cap) return;
    if (row === n) { count++; return; }
    for (let c = 0; c < n; c++) {
      if (colUsed[c]) continue;
      const regionId = region[row][c];
      if (regionUsed[regionId]) continue;
      if (row > 0 && Math.abs(c - placement[row - 1]) <= 1) continue;
      colUsed[c] = true;
      regionUsed[regionId] = true;
      placement[row] = c;
      backtrack(row + 1);
      colUsed[c] = false;
      regionUsed[regionId] = false;
      placement[row] = -1;
      if (count >= cap) return;
    }
  }
  backtrack(0);
  return count;
}

// Retries with a fresh solution + region growth until the puzzle has a
// unique solution (solvable by pure deduction, not a guess among several
// valid boards) -- almost always found within a handful of attempts at
// these grid sizes; the last attempt is used regardless as a safety net
// so this can never hang.
function generatePuzzle(n) {
  let last = null;
  for (let attempt = 0; attempt < 300; attempt++) {
    const solution = generateSolution(n);
    if (!solution) continue;
    const region = generateRegions(n, solution);
    last = { n, region, solution };
    if (countSolutions(n, region, 2) === 1) return last;
  }
  return last;
}

function emptyBoard(n) {
  return Array.from({ length: n }, () => new Array(n).fill('empty'));
}

function hasConflict(board, region, n, r, c) {
  const myRegion = region[r][c];
  for (let rr = 0; rr < n; rr++) {
    for (let cc = 0; cc < n; cc++) {
      if (board[rr][cc] !== 'filled' || (rr === r && cc === c)) continue;
      if (rr === r || cc === c) return true;
      if (region[rr][cc] === myRegion) return true;
      if (Math.abs(rr - r) <= 1 && Math.abs(cc - c) <= 1) return true;
    }
  }
  return false;
}

function countFilled(board) {
  return board.reduce((sum, row) => sum + row.filter((cell) => cell === 'filled').length, 0);
}

export default function NotedokuGame({ onGameOver }) {
  const [status, setStatus] = useState('picking'); // picking | generating | playing | won | lost
  const [n, setN] = useState(null);
  const [region, setRegion] = useState(null);
  const [board, setBoard] = useState(null);
  const [mistakesUsed, setMistakesUsed] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [shakeCell, setShakeCell] = useState(null);
  const finishedRef = useRef(false);

  useEffect(() => {
    if (status !== 'playing') return;
    const id = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [status]);

  function startGame(size) {
    setN(size);
    setStatus('generating');
    // A brief yield before the (synchronous, occasionally not-quite-
    // instant) generation runs, so the "Generating…" state actually gets
    // a chance to paint instead of the click feeling unresponsive.
    setTimeout(() => {
      const puzzle = generatePuzzle(size);
      setRegion(puzzle.region);
      setBoard(emptyBoard(size));
      setMistakesUsed(0);
      setElapsedSeconds(0);
      finishedRef.current = false;
      setStatus('playing');
    }, 30);
  }

  function finish(won, finalMistakes) {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setStatus(won ? 'won' : 'lost');
    const base = n * 60;
    const mistakePenalty = finalMistakes * 40;
    const timeBonus = Math.max(0, 180 - elapsedSeconds) * 1.5;
    const score = won ? Math.max(30, Math.round(base - mistakePenalty + timeBonus)) : 15;
    onGameOver(score);
  }

  function handleCellClick(r, c) {
    if (status !== 'playing') return;
    const cell = board[r][c];

    if (cell === 'empty') {
      const next = board.map((row) => [...row]);
      next[r][c] = 'marked';
      setBoard(next);
      return;
    }

    if (cell === 'marked') {
      if (hasConflict(board, region, n, r, c)) {
        const nextMistakes = mistakesUsed + 1;
        setMistakesUsed(nextMistakes);
        setShakeCell(r + '-' + c);
        vibrate(80);
        setTimeout(() => setShakeCell(null), 400);
        const reverted = board.map((row) => [...row]);
        reverted[r][c] = 'empty';
        setBoard(reverted);
        if (nextMistakes >= MAX_MISTAKES) finish(false, nextMistakes);
        return;
      }
      const next = board.map((row) => [...row]);
      next[r][c] = 'filled';
      setBoard(next);
      if (countFilled(next) === n) finish(true, mistakesUsed);
      return;
    }

    // filled -- tapping it again picks it back up
    const next = board.map((row) => [...row]);
    next[r][c] = 'empty';
    setBoard(next);
  }

  if (status === 'picking' || status === 'generating') {
    return (
      <div style={{ textAlign: 'center' }}>
        <p className="field__hint" style={{ marginBottom: 4 }}>
          One instrument per colour, one per row, one per column — and no two touching, not even diagonally.
        </p>
        <p className="field__hint" style={{ marginBottom: 12 }}>
          Tap once to mark a square with ✕, tap again to place an instrument there.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          {DIFFICULTIES.map((d) => (
            <button
              key={d.key}
              type="button"
              className="btn btn--ghost btn--small"
              onClick={() => startGame(d.size)}
              disabled={status === 'generating'}
              style={{ width: 'auto', padding: '10px 18px' }}
            >
              {d.label} · {d.size}×{d.size}
            </button>
          ))}
        </div>
        {status === 'generating' && <p className="field__hint" style={{ marginTop: 12 }}>Generating puzzle…</p>}
      </div>
    );
  }

  const cellSize = n <= 6 ? 46 : n === 7 ? 41 : 37;
  const fontSize = Math.round(cellSize * 0.52);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', fontSize: 13 }}>
        <span aria-label={(MAX_MISTAKES - mistakesUsed) + ' of ' + MAX_MISTAKES + ' hearts left'}>
          {Array.from({ length: MAX_MISTAKES }).map((_, i) => (
            <span key={i} style={{ opacity: i < MAX_MISTAKES - mistakesUsed ? 1 : 0.2 }}>❤️</span>
          ))}
        </span>
        <span className="field__hint" style={{ fontFamily: 'var(--font-mono)' }}>
          {String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')}:{String(elapsedSeconds % 60).padStart(2, '0')}
        </span>
      </div>

      <div style={{ borderRadius: 10, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.12)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${n}, ${cellSize}px)` }}>
          {board.map((row, r) =>
            row.map((cell, c) => {
              const myRegion = region[r][c];
              const rightDiff = c === n - 1 || region[r][c + 1] !== myRegion;
              const bottomDiff = r === n - 1 || region[r + 1][c] !== myRegion;
              const topDiff = r === 0 || region[r - 1][c] !== myRegion;
              const leftDiff = c === 0 || region[r][c - 1] !== myRegion;
              return (
                <button
                  key={r + '-' + c}
                  type="button"
                  onClick={() => handleCellClick(r, c)}
                  disabled={status !== 'playing'}
                  className={shakeCell === r + '-' + c ? 'arcade-shake' : ''}
                  style={{
                    width: cellSize,
                    height: cellSize,
                    padding: 0,
                    background: REGION_COLORS[myRegion % REGION_COLORS.length],
                    borderTop: topDiff ? '2px solid rgba(0,0,0,0.55)' : '1px solid rgba(0,0,0,0.1)',
                    borderLeft: leftDiff ? '2px solid rgba(0,0,0,0.55)' : '1px solid rgba(0,0,0,0.1)',
                    borderRight: rightDiff ? '2px solid rgba(0,0,0,0.55)' : 'none',
                    borderBottom: bottomDiff ? '2px solid rgba(0,0,0,0.55)' : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize,
                    lineHeight: 1,
                    cursor: status === 'playing' ? 'pointer' : 'default',
                    touchAction: 'manipulation',
                    WebkitTapHighlightColor: 'transparent',
                    color: '#2a2a2a',
                    fontWeight: 700,
                  }}
                >
                  {cell === 'filled' ? INSTRUMENT_ICONS[myRegion % INSTRUMENT_ICONS.length] : cell === 'marked' ? '✕' : ''}
                </button>
              );
            })
          )}
        </div>
      </div>

      {(status === 'won' || status === 'lost') && (
        <p className="field__hint" style={{ fontWeight: 700 }}>
          {status === 'won' ? '🎉 Solved it!' : 'Out of hearts — better luck next time.'}
        </p>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        {status === 'playing' && (
          <button type="button" className="btn btn--ghost btn--small" style={{ width: 'auto' }} onClick={() => startGame(n)}>
            Restart this size
          </button>
        )}
        {(status === 'won' || status === 'lost') && (
          <button type="button" className="btn btn--primary btn--small" style={{ width: 'auto' }} onClick={() => setStatus('picking')}>
            New puzzle
          </button>
        )}
      </div>
    </div>
  );
}

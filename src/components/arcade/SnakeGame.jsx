import { useEffect, useRef, useState, useCallback } from 'react';

const GRID = 15;
const CELL = 24;
const TICK_MS = 150;
const SWIPE_MIN_PX = 24; // ignores an accidental tap/jitter being read as a swipe

function randomCell(exclude) {
  let cell;
  do {
    cell = { x: Math.floor(Math.random() * GRID), y: Math.floor(Math.random() * GRID) };
  } while (exclude.some((c) => c.x === cell.x && c.y === cell.y));
  return cell;
}

// Reads the app's actual theme colours rather than hardcoding hex, so the
// board matches whichever of the four colour themes (My Profile) is
// active instead of always looking like the default one.
function themeColor(varName, fallback) {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return v || fallback;
}

function vibrate(pattern) {
  try { navigator.vibrate?.(pattern); } catch { /* iOS Safari has no Vibration API -- fine to no-op */ }
}

// ctx.roundRect landed in every major engine a couple of years back, but a
// tiny manual fallback costs nothing and means one old in-the-wild browser
// doesn't draw square segments instead of rounded ones.
function roundedRect(ctx, x, y, w, h, r) {
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function DirectionIcon({ dir }) {
  const rotation = { up: 0, right: 90, down: 180, left: 270 }[dir];
  return (
    <svg viewBox="0 0 24 24" fill="none" style={{ transform: `rotate(${rotation}deg)` }} aria-hidden="true">
      <path d="M12 5l7 12H5z" fill="currentColor" />
    </svg>
  );
}

export default function SnakeGame({ onGameOver }) {
  const canvasRef = useRef(null);
  const stateRef = useRef(null);
  const rafRef = useRef(null);
  const touchStartRef = useRef(null);
  const [score, setScore] = useState(0);
  const [status, setStatus] = useState('ready'); // ready | playing | over
  const [scorePop, setScorePop] = useState(false);
  const finishedRef = useRef(false);

  const draw = useCallback((now) => {
    const canvas = canvasRef.current;
    const s = stateRef.current;
    if (!canvas || !s) return;
    const ctx = canvas.getContext('2d');
    const size = GRID * CELL;

    const bg = themeColor('--paper-raised', '#f1ede4');
    const headColour = themeColor('--teal', '#2f7d4f');
    const foodColour = themeColor('--rust', '#c8862e');
    const ink = themeColor('--ink', '#1e1b16');

    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size, size);

    // A gentle pulse rather than a static square -- the single biggest
    // "this feels alive" cue on an otherwise still board between ticks.
    const pulse = 1 + Math.sin(now / 220) * 0.08;
    const foodSize = (CELL - 8) * pulse;
    const foodCx = s.food.x * CELL + CELL / 2;
    const foodCy = s.food.y * CELL + CELL / 2;
    ctx.fillStyle = foodColour;
    ctx.beginPath();
    ctx.arc(foodCx, foodCy, foodSize / 2, 0, Math.PI * 2);
    ctx.fill();

    // Segments slide from their previous tick's position to their current
    // one instead of jumping there instantly -- t is how far through the
    // current tick interval we are, right now, at render time.
    const t = Math.min(1, (now - s.lastTickAt) / TICK_MS);
    const count = s.snake.length;
    for (let i = count - 1; i >= 0; i--) {
      const cur = s.snake[i];
      const prev = s.prevSnake[i] || s.prevSnake[s.prevSnake.length - 1] || cur;
      const x = lerp(prev.x, cur.x, t);
      const y = lerp(prev.y, cur.y, t);
      const isHead = i === 0;
      // Tapers very slightly toward the tail -- a small, cheap touch that
      // reads as "one continuous body" rather than a stack of identical tiles.
      const shrink = Math.min(4, i * 0.25);
      const pad = 2 + shrink / 2;
      const segSize = CELL - pad * 2;
      ctx.fillStyle = isHead ? headColour : headColour + (count - i > 12 ? 'aa' : 'dd');
      roundedRect(ctx, x * CELL + pad, y * CELL + pad, segSize, segSize, isHead ? 8 : 6);
      ctx.fill();

      if (isHead) {
        // Two small eyes oriented toward the current heading -- gives the
        // head an obvious "front" instead of being just another square.
        ctx.fillStyle = bg;
        const ex = s.dir.x * 4;
        const ey = s.dir.y * 4;
        const perpX = s.dir.y * 4;
        const perpY = s.dir.x * 4;
        const cx = x * CELL + CELL / 2;
        const cy = y * CELL + CELL / 2;
        ctx.beginPath();
        ctx.arc(cx + ex + perpX, cy + ey + perpY, 2, 0, Math.PI * 2);
        ctx.arc(cx + ex - perpX, cy + ey - perpY, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, []);

  const renderLoop = useCallback((now) => {
    draw(now);
    rafRef.current = requestAnimationFrame(renderLoop);
  }, [draw]);

  useEffect(() => {
    if (status !== 'playing') return;
    rafRef.current = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [status, renderLoop]);

  const endGame = useCallback((finalScore) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    vibrate([40, 60, 40]);
    setStatus('over');
    onGameOver(finalScore);
  }, [onGameOver]);

  const startGame = useCallback(() => {
    finishedRef.current = false;
    const snake = [{ x: 7, y: 7 }, { x: 6, y: 7 }, { x: 5, y: 7 }];
    stateRef.current = {
      snake,
      prevSnake: snake,
      dir: { x: 1, y: 0 },
      nextDir: { x: 1, y: 0 },
      food: randomCell(snake),
      lastTickAt: performance.now(),
    };
    setScore(0);
    setStatus('playing');
  }, []);

  useEffect(() => {
    if (status !== 'playing') return;
    const interval = setInterval(() => {
      const s = stateRef.current;
      s.dir = s.nextDir;
      const head = { x: s.snake[0].x + s.dir.x, y: s.snake[0].y + s.dir.y };

      const hitWall = head.x < 0 || head.y < 0 || head.x >= GRID || head.y >= GRID;
      const hitSelf = s.snake.some((seg) => seg.x === head.x && seg.y === head.y);
      if (hitWall || hitSelf) {
        endGame(s.snake.length * 10 - 30);
        clearInterval(interval);
        return;
      }

      s.prevSnake = s.snake;
      const nextSnake = [head, ...s.snake];
      if (head.x === s.food.x && head.y === s.food.y) {
        s.food = randomCell(nextSnake);
        s.snake = nextSnake;
        vibrate(15);
        setScore((sc) => sc + 10);
        setScorePop(true);
        setTimeout(() => setScorePop(false), 220);
      } else {
        nextSnake.pop();
        s.snake = nextSnake;
      }
      s.lastTickAt = performance.now();
    }, TICK_MS);
    return () => clearInterval(interval);
  }, [status, endGame]);

  const setDirection = useCallback((x, y) => {
    const s = stateRef.current;
    if (!s || status !== 'playing') return;
    // No reversing directly into yourself.
    if (s.dir.x === -x && s.dir.y === -y) return;
    s.nextDir = { x, y };
  }, [status]);

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'ArrowUp') setDirection(0, -1);
      else if (e.key === 'ArrowDown') setDirection(0, 1);
      else if (e.key === 'ArrowLeft') setDirection(-1, 0);
      else if (e.key === 'ArrowRight') setDirection(1, 0);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setDirection]);

  function handleTouchStart(e) {
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY };
  }

  function handleTouchEnd(e) {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN_PX) return; // too small to count as a swipe
    if (Math.abs(dx) > Math.abs(dy)) setDirection(dx > 0 ? 1 : -1, 0);
    else setDirection(0, dy > 0 ? 1 : -1);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
      {status !== 'ready' && (
        <p className={'field__hint' + (scorePop ? ' arcade-score-pop' : '')} style={{ fontWeight: 700, fontSize: 15 }}>
          Score: {score}
        </p>
      )}
      {status === 'ready' && (
        <button type="button" className="btn btn--primary" onClick={startGame}>Start Snake</button>
      )}
      {status !== 'ready' && (
        <div
          className="snake-board-wrap"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <canvas ref={canvasRef} width={GRID * CELL} height={GRID * CELL} />
        </div>
      )}
      {status !== 'ready' && (
        <p className="field__hint" style={{ fontSize: 12 }}>Swipe on the board, or use the arrows below</p>
      )}
      {status === 'over' && (
        <button type="button" className="btn btn--primary btn--small" onClick={startGame}>Play again (uses another life)</button>
      )}
      {status === 'playing' && (
        <div className="snake-dpad">
          <span />
          <button type="button" className="snake-dpad__btn" onClick={() => setDirection(0, -1)} aria-label="Up">
            <DirectionIcon dir="up" />
          </button>
          <span />
          <button type="button" className="snake-dpad__btn" onClick={() => setDirection(-1, 0)} aria-label="Left">
            <DirectionIcon dir="left" />
          </button>
          <span />
          <button type="button" className="snake-dpad__btn" onClick={() => setDirection(1, 0)} aria-label="Right">
            <DirectionIcon dir="right" />
          </button>
          <span />
          <button type="button" className="snake-dpad__btn" onClick={() => setDirection(0, 1)} aria-label="Down">
            <DirectionIcon dir="down" />
          </button>
          <span />
        </div>
      )}
    </div>
  );
}

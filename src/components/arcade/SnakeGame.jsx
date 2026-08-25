import { useEffect, useRef, useState, useCallback } from 'react';

const GRID = 15;
const CELL = 20;
const TICK_MS = 160;

function randomCell(exclude) {
  let cell;
  do {
    cell = { x: Math.floor(Math.random() * GRID), y: Math.floor(Math.random() * GRID) };
  } while (exclude.some((c) => c.x === cell.x && c.y === cell.y));
  return cell;
}

export default function SnakeGame({ onGameOver }) {
  const canvasRef = useRef(null);
  const stateRef = useRef(null);
  const [score, setScore] = useState(0);
  const [status, setStatus] = useState('ready'); // ready | playing | over
  const finishedRef = useRef(false);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { snake, food } = stateRef.current;
    ctx.fillStyle = 'var(--paper-raised)'.startsWith('var') ? '#f1ede4' : '#f1ede4';
    ctx.fillRect(0, 0, GRID * CELL, GRID * CELL);
    ctx.fillStyle = '#c8862e';
    ctx.fillRect(food.x * CELL + 2, food.y * CELL + 2, CELL - 4, CELL - 4);
    snake.forEach((seg, i) => {
      ctx.fillStyle = i === 0 ? '#2f7d4f' : '#4a9c6b';
      ctx.fillRect(seg.x * CELL + 1, seg.y * CELL + 1, CELL - 2, CELL - 2);
    });
  }, []);

  const endGame = useCallback((finalScore) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setStatus('over');
    onGameOver(finalScore);
  }, [onGameOver]);

  const startGame = useCallback(() => {
    finishedRef.current = false;
    const snake = [{ x: 7, y: 7 }, { x: 6, y: 7 }, { x: 5, y: 7 }];
    stateRef.current = {
      snake,
      dir: { x: 1, y: 0 },
      nextDir: { x: 1, y: 0 },
      food: randomCell(snake),
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

      s.snake.unshift(head);
      if (head.x === s.food.x && head.y === s.food.y) {
        s.food = randomCell(s.snake);
        setScore((sc) => sc + 10);
      } else {
        s.snake.pop();
      }
      draw();
    }, TICK_MS);
    return () => clearInterval(interval);
  }, [status, draw, endGame]);

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

  useEffect(() => {
    if (status === 'playing') draw();
  }, [status, draw]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      {status !== 'ready' && <p className="field__hint" style={{ fontWeight: 700 }}>Score: {score}</p>}
      {status === 'ready' && (
        <button type="button" className="btn btn--primary" onClick={startGame}>Start Snake</button>
      )}
      {status !== 'ready' && (
        <canvas
          ref={canvasRef}
          width={GRID * CELL}
          height={GRID * CELL}
          style={{ background: '#f1ede4', borderRadius: 8, border: '1px solid var(--line)', touchAction: 'none' }}
        />
      )}
      {status === 'over' && (
        <button type="button" className="btn btn--primary btn--small" onClick={startGame}>Play again (uses another life)</button>
      )}
      {status === 'playing' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 48px)', gap: 4 }}>
          <span />
          <button type="button" className="btn btn--ghost btn--small" onClick={() => setDirection(0, -1)}>↑</button>
          <span />
          <button type="button" className="btn btn--ghost btn--small" onClick={() => setDirection(-1, 0)}>←</button>
          <span />
          <button type="button" className="btn btn--ghost btn--small" onClick={() => setDirection(1, 0)}>→</button>
          <span />
          <button type="button" className="btn btn--ghost btn--small" onClick={() => setDirection(0, 1)}>↓</button>
          <span />
        </div>
      )}
    </div>
  );
}

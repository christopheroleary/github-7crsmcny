import { useEffect, useRef } from 'react';

// Draws with mouse, touch, or stylus via the unified Pointer Events API --
// one code path for a finger on a phone and a mouse on a desktop. Exposes
// the drawn strokes as a compressed webp data URL through onChange (null
// once cleared or before any stroke exists), which the caller stores
// directly as the signature image -- no upload, no storage bucket.
//
// Move/up listeners are attached to window for the duration of each stroke
// rather than using setPointerCapture -- capture ties delivery to the
// canvas element in a way that's proven flaky for the very first stroke
// on a freshly-mounted canvas on some browser/OS combos (drew nothing on
// the first click-drag, worked on the second). Plain window listeners
// have no such dependency and still track the pointer correctly even if
// it strays outside the canvas mid-stroke.
export default function SignaturePad({ onChange }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const hasStrokeRef = useRef(false);
  const lastPointRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1a1a1a';
  }, []);

  function pointFromEvent(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function drawDot(point) {
    const ctx = canvasRef.current.getContext('2d');
    ctx.beginPath();
    ctx.arc(point.x, point.y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
  }

  function drawLine(from, to) {
    const ctx = canvasRef.current.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }

  function emitChange() {
    if (!hasStrokeRef.current) {
      onChange(null);
      return;
    }
    // toDataURL falls back to PNG in any browser that can't encode webp,
    // so this is safe everywhere even though webp keeps the common case
    // small.
    onChange(canvasRef.current.toDataURL('image/webp', 0.85));
  }

  function handlePointerDown(e) {
    e.preventDefault();
    drawingRef.current = true;
    const point = pointFromEvent(e);
    lastPointRef.current = point;
    // A plain tap/click (down+up with no movement in between) never fired
    // a move, so it drew nothing and looked like the first click "didn't
    // work" -- dotting the start point here means every press leaves a
    // mark immediately, drag or not.
    drawDot(point);
    hasStrokeRef.current = true;

    function handleMove(moveEvent) {
      const p = pointFromEvent(moveEvent);
      drawLine(lastPointRef.current, p);
      lastPointRef.current = p;
      hasStrokeRef.current = true;
    }
    function handleUp() {
      drawingRef.current = false;
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      emitChange();
    }
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }

  function handleClear() {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    hasStrokeRef.current = false;
    onChange(null);
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: 160,
          touchAction: 'none',
          border: '1px solid var(--line)',
          borderRadius: 8,
          background: '#fff',
          cursor: 'crosshair',
          display: 'block',
        }}
        onPointerDown={handlePointerDown}
      />
      <button type="button" className="link-button" onClick={handleClear} style={{ marginTop: 4 }}>
        Clear
      </button>
    </div>
  );
}

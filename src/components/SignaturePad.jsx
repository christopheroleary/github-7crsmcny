import { useEffect, useRef } from 'react';

// Draws with mouse, touch, or stylus via the unified Pointer Events API --
// one code path for a finger on a phone and a mouse on a desktop. Exposes
// the drawn strokes as a compressed webp data URL through onChange (null
// once cleared or before any stroke exists), which the caller stores
// directly as the signature image -- no upload, no storage bucket.
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

  function handlePointerDown(e) {
    e.preventDefault();
    canvasRef.current.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const point = pointFromEvent(e);
    lastPointRef.current = point;
    // A plain tap/click (down+up with no movement in between) never fired
    // a pointermove, so it drew nothing and looked like the first click
    // "didn't work" -- dotting the start point here means every press
    // leaves a mark immediately, drag or not.
    const ctx = canvasRef.current.getContext('2d');
    ctx.beginPath();
    ctx.arc(point.x, point.y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
    hasStrokeRef.current = true;
  }

  function handlePointerMove(e) {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    const point = pointFromEvent(e);
    ctx.beginPath();
    ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    lastPointRef.current = point;
    hasStrokeRef.current = true;
  }

  function handlePointerUp(e) {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    canvasRef.current.releasePointerCapture(e.pointerId);
    emitChange();
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
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      />
      <button type="button" className="link-button" onClick={handleClear} style={{ marginTop: 4 }}>
        Clear
      </button>
    </div>
  );
}

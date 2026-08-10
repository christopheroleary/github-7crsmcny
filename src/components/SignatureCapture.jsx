import { useState } from 'react';
import SignaturePad from './SignaturePad.jsx';

// Shared by the client's public-link signing flow and the band's admin
// one-click flow. A typed name is always required (it's what ends up as
// the legible "signature / name" line on the document -- a drawn mark
// alone isn't necessarily readable), and drawing is an optional extra on
// top of that, not a replacement for it.
export default function SignatureCapture({ defaultName = '', onSign, signing, submitLabel = '✓ Sign', error }) {
  const [mode, setMode] = useState('type');
  const [name, setName] = useState(defaultName);
  const [drawnImage, setDrawnImage] = useState(null);

  const canSubmit = mode === 'type'
    ? name.trim().length > 0
    : name.trim().length > 0 && Boolean(drawnImage);

  function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit || signing) return;
    onSign(name.trim(), mode === 'drawn' ? drawnImage : null, mode);
  }

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <button
          type="button"
          className={mode === 'type' ? 'btn btn--primary btn--small' : 'btn btn--ghost btn--small'}
          onClick={() => setMode('type')}
        >
          Type
        </button>
        <button
          type="button"
          className={mode === 'drawn' ? 'btn btn--primary btn--small' : 'btn btn--ghost btn--small'}
          onClick={() => setMode('drawn')}
        >
          Draw
        </button>
      </div>

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Type your full name"
        style={{ marginBottom: 8 }}
        required
      />

      {mode === 'drawn' && (
        <div style={{ marginBottom: 8 }}>
          <SignaturePad onChange={setDrawnImage} />
          <span className="field__hint">Draw with your finger or a mouse.</span>
        </div>
      )}

      <button type="submit" className="btn btn--primary btn--small" disabled={signing || !canSubmit}>
        {signing ? 'Signing…' : submitLabel}
      </button>
      {error && <p className="form-error" style={{ marginTop: 6 }}>{error}</p>}
    </form>
  );
}

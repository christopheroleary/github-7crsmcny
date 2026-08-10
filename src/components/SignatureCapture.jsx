import { useState } from 'react';
import SignaturePad from './SignaturePad.jsx';

// Shared by the client's public-link signing flow and the band's admin
// one-click flow. A typed name is always required (it's what ends up as
// the legible "signature / name" line on the document -- a drawn mark
// alone isn't necessarily readable) and always shown alongside the pad,
// no type-vs-draw toggle to pick between -- drawing is just an optional
// extra on top of the name, not a separate mode.
export default function SignatureCapture({ defaultName = '', onSign, signing, submitLabel = '✓ Sign', error }) {
  const [name, setName] = useState(defaultName);
  const [drawnImage, setDrawnImage] = useState(null);

  const canSubmit = name.trim().length > 0;

  function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit || signing) return;
    onSign(name.trim(), drawnImage, drawnImage ? 'drawn' : 'typed');
  }

  return (
    <form onSubmit={handleSubmit}>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Type your full name"
        style={{ marginBottom: 8 }}
        required
      />

      <div style={{ marginBottom: 8 }}>
        <SignaturePad onChange={setDrawnImage} />
        <span className="field__hint">Optional — draw with your finger or a mouse.</span>
      </div>

      <button type="submit" className="btn btn--primary btn--small" disabled={signing || !canSubmit}>
        {signing ? 'Signing…' : submitLabel}
      </button>
      {error && <p className="form-error" style={{ marginTop: 6 }}>{error}</p>}
    </form>
  );
}

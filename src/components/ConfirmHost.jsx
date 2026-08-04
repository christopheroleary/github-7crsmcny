import { useEffect, useState } from 'react';
import { registerConfirmListener } from '../utils/confirmService.js';

export default function ConfirmHost() {
  const [pending, setPending] = useState(null);

  useEffect(() => registerConfirmListener((message, resolve) => {
    setPending({ message, resolve });
  }), []);

  if (!pending) return null;

  function respond(ok) {
    pending.resolve(ok);
    setPending(null);
  }

  return (
    <div className="modal-overlay" onClick={() => respond(false)}>
      <div className="modal-panel confirm-panel" onClick={(e) => e.stopPropagation()}>
        <p className="confirm-panel__message">{pending.message}</p>
        <div className="confirm-panel__actions">
          <button type="button" className="btn btn--ghost" onClick={() => respond(false)}>Cancel</button>
          <button type="button" className="btn btn--danger" onClick={() => respond(true)} autoFocus>OK</button>
        </div>
      </div>
    </div>
  );
}

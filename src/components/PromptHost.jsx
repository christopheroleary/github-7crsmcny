import { useEffect, useState } from 'react';
import { registerPromptListener } from '../utils/promptService.js';

export default function PromptHost() {
  const [pending, setPending] = useState(null);
  const [value, setValue] = useState('');

  useEffect(() => registerPromptListener((message, defaultValue, resolve) => {
    setPending({ message, resolve });
    setValue(defaultValue);
  }), []);

  if (!pending) return null;

  function respond(result) {
    pending.resolve(result);
    setPending(null);
  }

  return (
    <div className="modal-overlay" onClick={() => respond(null)}>
      <div className="modal-panel confirm-panel" onClick={(e) => e.stopPropagation()}>
        <p className="confirm-panel__message">{pending.message}</p>
        <textarea
          className="prompt-panel__input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={3}
          autoFocus
        />
        <div className="confirm-panel__actions">
          <button type="button" className="btn btn--ghost" onClick={() => respond(null)}>Cancel</button>
          <button type="button" className="btn btn--primary" style={{ width: 'auto' }} onClick={() => respond(value)}>OK</button>
        </div>
      </div>
    </div>
  );
}

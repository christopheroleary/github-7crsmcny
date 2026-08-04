import { useEffect, useState, useRef } from 'react';
import { registerToastListener } from '../utils/toastService.js';

let idCounter = 0;

export default function ToastHost() {
  const [toasts, setToasts] = useState([]);
  const timers = useRef({});

  useEffect(() => registerToastListener((message) => {
    const id = ++idCounter;
    setToasts((prev) => [...prev, { id, message }]);
    timers.current[id] = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      delete timers.current[id];
    }, 6000);
  }), []);

  useEffect(() => () => {
    Object.values(timers.current).forEach(clearTimeout);
  }, []);

  if (!toasts.length) return null;

  function dismiss(id) {
    clearTimeout(timers.current[id]);
    delete timers.current[id];
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <div className="toast" key={t.id} role="alert">
          <span className="toast__message">{t.message}</span>
          <button type="button" className="toast__close" aria-label="Dismiss" onClick={() => dismiss(t.id)}>×</button>
        </div>
      ))}
    </div>
  );
}

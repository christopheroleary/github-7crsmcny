import { useState, useEffect } from 'react';

// Module-level (not component-level) so the listener attaches the moment
// this file is first imported -- Chrome can fire `beforeinstallprompt`
// before any particular component mounts, and the event can only be used
// once, so it has to be captured centrally and handed out to whichever
// component asks for it later.
let capturedPrompt = null;
let listeners = [];

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    capturedPrompt = e;
    listeners.forEach((cb) => cb(e));
  });
  window.addEventListener('appinstalled', () => {
    capturedPrompt = null;
    listeners.forEach((cb) => cb(null));
  });
}

// Chrome/Edge (desktop + Android) support a native one-tap install prompt.
// Safari and Firefox never fire this event -- callers must fall back to
// manual "here's how" instructions when canPromptInstall is false.
export function useInstallPrompt() {
  const [prompt, setPrompt] = useState(capturedPrompt);

  useEffect(() => {
    const cb = (e) => setPrompt(e);
    listeners.push(cb);
    return () => {
      listeners = listeners.filter((l) => l !== cb);
    };
  }, []);

  async function promptInstall() {
    if (!prompt) return null;
    prompt.prompt();
    const choice = await prompt.userChoice;
    capturedPrompt = null;
    setPrompt(null);
    return choice.outcome; // 'accepted' | 'dismissed'
  }

  return { canPromptInstall: !!prompt, promptInstall };
}

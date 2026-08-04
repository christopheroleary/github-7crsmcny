// Same rationale as confirmService.js -- window.prompt() no-ops on an iOS
// home-screen (standalone display mode) PWA. In-app replacement rendered
// by <PromptHost/> (mounted once in App.jsx). Resolves to the entered
// string (possibly empty) on OK, or null on Cancel -- matching
// window.prompt()'s own return contract so call sites don't need to change.
let listener = null;

export function registerPromptListener(fn) {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

export function promptAsync(message, defaultValue = '') {
  return new Promise((resolve) => {
    if (!listener) {
      resolve(null);
      return;
    }
    listener(message, defaultValue, resolve);
  });
}

// window.confirm()/alert() are unsupported in an iOS home-screen (standalone
// display mode) PWA -- they silently no-op instead of showing anything, so a
// button wired to `if (!window.confirm(...)) return;` looks completely dead
// on a device the app is actually installed on. This is an in-app replacement
// rendered by <ConfirmHost/> (mounted once in App.jsx) so it works the same
// in a browser tab, installed PWA, and on iOS or Android.
let listener = null;

export function registerConfirmListener(fn) {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

export function confirmAsync(message) {
  return new Promise((resolve) => {
    if (!listener) {
      resolve(false);
      return;
    }
    listener(message, resolve);
  });
}

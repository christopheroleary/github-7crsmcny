// window.alert() has the same iOS home-screen (standalone display mode) PWA
// limitation as window.confirm() (see confirmService.js) -- it silently
// no-ops instead of showing anything, so error feedback after a failed save
// would otherwise vanish with zero indication anything went wrong. This is
// an in-app replacement rendered by <ToastHost/> (mounted once in App.jsx).
let listener = null;

export function registerToastListener(fn) {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

// type defaults to 'error' since that's what the vast majority of existing
// call sites actually are (save/validation failures) -- callers reporting
// something that went right pass 'success' explicitly rather than every
// other call site needing to opt in just to keep today's look.
export function notify(message, type = 'error') {
  if (!listener) return;
  listener(message, type);
}

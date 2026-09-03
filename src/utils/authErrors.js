// A getSession()/refresh call can fail for two very different reasons:
// the network being bad (no signal at a gig, wifi with no real internet,
// the connection dropping mid-request) vs. the server genuinely rejecting
// the request (expired/revoked refresh token, bad credentials). Only the
// second one means "actually signed out". supabase-js's own retry logic
// already makes this distinction internally (see @supabase/auth-js's
// isAuthRetryableFetchError) but doesn't expose the helper from the
// public package, so this matches its tag directly. Deliberately not
// navigator.onLine, which reports true on a wifi network with no working
// internet -- exactly the case this needs to catch.
//
// Shared between App.jsx (its own getSession() call) and
// ProfileContext.jsx (a second, independent getSession() call) --
// they used to disagree on this: App.jsx already fell back to the cached
// session on a network failure, but ProfileContext treated the same
// failure as a real sign-out and wiped the profile it had just shown
// from cache. `session` stayed truthy, `profile` went null, and nothing
// downstream expects that combination -- the first component that reads
// `profile.something` without a null-check throws, and with no error
// boundary in the tree (see ErrorBoundary.jsx) that took the whole app
// down to a blank screen. Caught live: reopening the app after a few
// hours away, at a gig with no signal.
export function isNetworkAuthError(error) {
  return error?.name === 'AuthRetryableFetchError';
}

// True when a Supabase call failed because the *network request* itself
// didn't go through (offline, timed out, DNS/TLS failure, dropped
// mid-request) rather than because the server rejected it (bad
// credentials, RLS denial, a real data error). Worth telling apart because
// "offline" needs a different message than "that failed" -- one is
// actionable ("check your connection"), the other isn't.
//
// Auth calls (GoTrueClient) self-tag this case as AuthRetryableFetchError.
// Other Supabase clients (PostgREST, Storage) don't tag it at all -- the
// underlying fetch() just rejects and the raw error's `.message` ends up
// on the caught error verbatim: "Load failed" on Safari/WebKit, "Failed to
// fetch" on Chrome, "NetworkError when attempting to fetch resource" on
// Firefox -- so those are matched by message text instead. Confirmed
// against this app's actual Supabase client by forcing a fetch failure and
// inspecting the real error shape, not assumed from docs.
//
// navigator.onLine is checked first since it's a cheap, reliable positive
// for the common case (airplane mode) -- it just can't be trusted for a
// negative (wifi connected to a router with no real internet still reports
// true), which the message-pattern fallback below covers.
export function isLikelyOfflineError(error) {
  if (!navigator.onLine) return true;
  if (error?.name === 'AuthRetryableFetchError') return true;
  const message = error?.message || '';
  return /load failed|failed to fetch|networkerror when attempting to fetch/i.test(message);
}

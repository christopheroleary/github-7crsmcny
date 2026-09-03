import { Component } from 'react';

// Last-resort catch-all -- without this, ANY uncaught render error
// anywhere in the tree (a null-check missed on `profile`, a bad prop, a
// third-party library throwing) unmounts the whole app down to a blank
// white screen, with nothing on it to explain what happened or how to
// get back. This is exactly what happened live: a stale offline session
// left `profile` null while the rest of the app assumed it was always
// set once loading finished (see authErrors.js / ProfileContext.jsx for
// the actual root cause of that specific case) -- fixed there, but a
// React error boundary is the only way to make *any* future instance of
// "something down the tree threw" fail as a recoverable screen instead
// of nothing at all. Must be a class component -- there is no hooks
// equivalent for getDerivedStateFromError/componentDidCatch.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // No network call here -- this can fire in exactly the situations
    // where a network call is least likely to succeed (offline, mid-crash),
    // and a reporting attempt that itself hangs or throws would only make
    // recovery worse. The browser console is still the real trail for
    // this session; reload is the actual fix for the person looking at it.
    console.error('Uncaught render error:', error, info?.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="login-page">
        <div className="login-card">
          <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 20, margin: '0 0 10px' }}>
            Something went wrong
          </h2>
          <p className="field__hint" style={{ margin: '0 0 20px' }}>
            The app hit a problem it couldn't recover from on its own. Reloading almost always fixes this --
            your data is safe either way, nothing here is stored only on this screen.
          </p>
          <button
            type="button"
            className="btn btn--primary"
            style={{ width: '100%' }}
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}

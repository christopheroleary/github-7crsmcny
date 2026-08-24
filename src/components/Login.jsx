import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { isLikelyOfflineError } from '../utils/networkError.js';

const RESET_COOLDOWN_SECONDS = 60;
const OFFLINE_MESSAGE = "You're offline — connect to the internet and try again.";

export default function Login() {
  const inviteParams = new URLSearchParams(window.location.search);
  const invitedName = inviteParams.get('invite') ? inviteParams.get('name') || '' : '';

  const [mode, setMode] = useState(inviteParams.get('invite') ? 'signUp' : 'signIn');
  const [fullName, setFullName] = useState(invitedName);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  // Client-side-only throttle on the reset-link button -- not a security
  // boundary (Supabase's server-side rate limits on /auth/v1/recover are
  // what actually protects the endpoint), just stops the same browser tab
  // from spam-clicking it.
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (mode === 'forgotPassword' && resendCooldown > 0) return;

    setSubmitting(true);

    if (mode === 'signIn') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      // A network failure here reads identically to "wrong password" unless
      // called out separately -- confirmed live that a failed fetch surfaces
      // as AuthRetryableFetchError, not a credentials rejection, so this
      // isn't guesswork about what Supabase might do.
      if (error) setError(isLikelyOfflineError(error) ? OFFLINE_MESSAGE : error.message);
    } else if (mode === 'forgotPassword') {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      });
      if (error) {
        setError(isLikelyOfflineError(error) ? OFFLINE_MESSAGE : error.message);
      } else {
        setInfo("If an account exists for that email, we've sent a link to reset your password.");
        setResendCooldown(RESET_COOLDOWN_SECONDS);
      }
    } else {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      });
      if (error) {
        setError(isLikelyOfflineError(error) ? OFFLINE_MESSAGE : error.message);
      } else {
        setInfo('Account created. If your project requires email confirmation, check your inbox before signing in.');
        setMode('signIn');
      }
    }
    setSubmitting(false);
  }

  const title = mode === 'signIn' ? 'Sign in' : mode === 'signUp' ? 'Create account' : 'Reset password';

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <p className="login-card__eyebrow">Gig Manager</p>
        <h1 className="login-card__title">{title}</h1>

        {mode === 'signUp' && (
          <label className="field">
            <span className="field__label">Full name</span>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </label>
        )}

        <label className="field">
          <span className="field__label">Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>

        {mode !== 'forgotPassword' && (
          <label className="field">
            <span className="field__label">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </label>
        )}

        {mode === 'signIn' && (
          <button
            type="button"
            className="login-card__toggle"
            style={{ marginBottom: 18 }}
            onClick={() => {
              setMode('forgotPassword');
              setError(null);
              setInfo(null);
            }}
          >
            Forgot password?
          </button>
        )}

        {error && <p className="login-card__error">{error}</p>}
        {info && <p className="login-card__info">{info}</p>}

        <button
          className="btn btn--primary"
          type="submit"
          disabled={submitting || (mode === 'forgotPassword' && resendCooldown > 0)}
        >
          {submitting
            ? 'Please wait…'
            : mode === 'forgotPassword' && resendCooldown > 0
              ? `Resend in ${resendCooldown}s`
              : mode === 'signIn'
                ? 'Sign in'
                : mode === 'forgotPassword'
                  ? 'Send reset link'
                  : 'Create account'}
        </button>

        <button
          type="button"
          className="login-card__toggle"
          onClick={() => {
            setMode(mode === 'signUp' ? 'signIn' : mode === 'forgotPassword' ? 'signIn' : 'signUp');
            setError(null);
            setInfo(null);
          }}
        >
          {mode === 'signIn' ? 'New band member? Create an account' : 'Already have an account? Sign in'}
        </button>
      </form>
    </div>
  );
}
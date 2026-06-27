import { useState } from 'react';
import { supabase } from '../supabaseClient';

export default function Login() {
  const [mode, setMode] = useState('signIn');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setSubmitting(true);

    if (mode === 'signIn') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
    } else {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      });
      if (error) {
        setError(error.message);
      } else {
        setInfo('Account created. If your project requires email confirmation, check your inbox before signing in.');
        setMode('signIn');
      }
    }
    setSubmitting(false);
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <p className="login-card__eyebrow">Gig Manager</p>
        <h1 className="login-card__title">{mode === 'signIn' ? 'Sign in' : 'Create account'}</h1>

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

        {error && <p className="login-card__error">{error}</p>}
        {info && <p className="login-card__info">{info}</p>}

        <button className="btn btn--primary" type="submit" disabled={submitting}>
          {submitting ? 'Please wait…' : mode === 'signIn' ? 'Sign in' : 'Create account'}
        </button>

        <button
          type="button"
          className="login-card__toggle"
          onClick={() => {
            setMode(mode === 'signIn' ? 'signUp' : 'signIn');
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
import { useState } from 'react';
import { api } from '../../lib/api';
import { useResource } from '../../lib/useResource';
import logo from '../../assets/amethyst-logo.png';

function AuthFrame({ children }) {
  return (
    <main className="entry-page">
      <header className="entry-brand">
        <span className="brand-gem" aria-hidden="true">◇</span> AMETHYST PLUS
        <span className="brand-caption">SCHEDULING HUB</span>
      </header>
      <section className="login-card">{children}</section>
      <footer className="entry-footer">
        <span>Clarity. Connection. Possibility.</span><span>AMETHYST PLUS</span>
      </footer>
    </main>
  );
}

export default function AuthGate({ children }) {
  const session = useResource('/auth/me');
  const [signup, setSignup] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const result = await api(`/auth/${signup ? 'signup' : 'login'}`, {
        method: 'POST',
        body: Object.fromEntries(new FormData(event.currentTarget)),
      });
      if (signup) {
        setMessage(result.message);
        setSignup(false);
      } else {
        session.refresh();
      }
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  if (session.loading) {
    return <AuthFrame><p className="form-message" role="status">Checking session…</p></AuthFrame>;
  }
  if (session.data && !session.error) {
    return children(session.data, async () => {
      await api('/auth/logout', { method: 'POST' });
      session.refresh();
    });
  }

  return (
    <AuthFrame>
      <img className="login-logo" src={logo} alt="Amethyst" />
      <p className="eyebrow">YOUR NEXT CHAPTER STARTS HERE</p>
      <h1>{signup ? 'Join Amethyst.' : 'Welcome inside.'}</h1>
      <p className="entry-description">One place for your department’s work.</p>
      <form onSubmit={submit}>
        {signup && <>
          <label>Name<input name="name" required autoComplete="name" /></label>
          <label>Department<input name="department" required defaultValue="General" /></label>
        </>}
        <label>Email<input name="email" type="email" required autoComplete="email" /></label>
        <label>Password<input name="password" type="password" minLength={12} required autoComplete={signup ? 'new-password' : 'current-password'} /></label>
        <button className="sign-in-button" disabled={busy}>
          {busy ? 'Please wait…' : signup ? 'Create account' : 'Log in'}
          <span aria-hidden="true">↗</span>
        </button>
      </form>
      {message && <p className="form-message" role="status">{message}</p>}
      {session.error && !session.error.includes('log in') && <p className="form-message" role="alert">{session.error}</p>}
      <button className="text-button" onClick={() => { setSignup(!signup); setMessage(''); }}>
        {signup ? 'Have an account? Log in' : 'Create an account'}
      </button>
    </AuthFrame>
  );
}

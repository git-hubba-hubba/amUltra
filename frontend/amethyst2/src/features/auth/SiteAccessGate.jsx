import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useResource } from '../../lib/useResource';
import logo from '../../assets/amethyst-logo.png';

export default function SiteAccessGate({ children }) {
 const access = useResource('/site-access');
 const refresh = access.refresh;
 const [busy, setBusy] = useState(false);
 const [error, setError] = useState('');
 useEffect(() => {
  window.addEventListener('amethyst:site-locked', refresh);
  window.addEventListener('focus', refresh);
  return () => {
   window.removeEventListener('amethyst:site-locked', refresh);
   window.removeEventListener('focus', refresh);
  };
 }, [refresh]);
 async function unlock(event) {
  event.preventDefault(); setBusy(true); setError('');
  try {
   await api('/site-access/unlock', { method: 'POST', body: { code: new FormData(event.currentTarget).get('code') } });
   refresh();
  } catch (failure) { setError(failure.message); }
  finally { setBusy(false); }
 }
 if (access.data?.unlocked) return <>
  <button className="site-lock-button" onClick={async () => {
   try { await api('/site-access/lock', { method: 'POST' }); refresh(); }
   catch (failure) { setError(failure.message); }
  }}>Lock site</button>
  {error && <p role="alert">{error}</p>}
  {children}
 </>;
 return <main className="entry-page">
  <header className="entry-brand"><span className="brand-gem" aria-hidden="true">◇</span> AMETHYST PLUS</header>
  <section className="login-card">
   <img className="login-logo" src={logo} alt="Amethyst" />
   <h1>Site locked.</h1>
   <p className="entry-description">Enter the admin access code to continue.</p>
   {access.loading ? <p role="status">Checking site access…</p> : <form onSubmit={unlock}>
    <label>Access code<input name="code" type="password" inputMode="numeric" autoComplete="off" required maxLength={200} /></label>
    <button className="sign-in-button" disabled={busy}>{busy ? 'Unlocking…' : 'Unlock site'}<span aria-hidden="true">↗</span></button>
   </form>}
   {(error || access.error) && <p className="form-message" role="alert">{error || access.error}</p>}
  </section>
  <footer className="entry-footer"><span>AMETHYST PLUS</span></footer>
 </main>;
}

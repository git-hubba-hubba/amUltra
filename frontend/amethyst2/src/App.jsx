import { useEffect, useState } from 'react';
import CrystalLanding from './components/CrystalLanding/CrystalLanding';
import AuthGate from './features/auth/AuthGate';
import Dashboard from './components/Dashboard';
import './App.css';
import './theme.css';

export default function App() {
  const [entered, setEntered] = useState(false);

  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('amethyst-theme') === 'dark' ? 'dark' : 'light'; }
    catch { return 'light'; }
  });
  useEffect(() => {
    try { localStorage.setItem('amethyst-theme', theme); } catch { /* Storage may be unavailable. */ }
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  return <div className="app-theme" data-theme={theme}>
    <button className="theme-toggle" aria-pressed={theme === 'dark'} aria-label="Dark mode" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
      <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span> {theme === 'dark' ? 'Light mode' : 'Dark mode'}
    </button>
    {!entered ? <CrystalLanding onEnter={() => setEntered(true)} /> : <AuthGate>{(user, logout) => <Dashboard user={user} logout={logout} />}</AuthGate>}
  </div>;
}

import { useEffect, useState, type FormEvent } from 'react';
import App from './App';
import { api, post, setToken, getToken, setUnauthorizedHandler, roleNames, type SessionUser } from './api';

// Las credenciales de prueba solo se muestran en desarrollo local o si VITE_SHOW_DEMO_USERS=true
const showDemo = import.meta.env.DEV || import.meta.env.VITE_SHOW_DEMO_USERS === 'true';
const demoUsers = [
  ['admin@visionai.pe', 'Admin#2026', 'Administrador'],
  ['supervisor@visionai.pe', 'Supervisor#2026', 'Supervisor'],
  ['operador@visionai.pe', 'Operador#2026', 'Operador'],
  ['auditor@visionai.pe', 'Auditor#2026', 'Auditor'],
];

function Login({ onLogin }: { onLogin: (u: SessionUser) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const r = await post<{ token: string; user: SessionUser }>('/api/auth/login', { email, password });
      setToken(r.token); onLogin(r.user);
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  };
  return <div className="login-page">
    <form className="login-card" onSubmit={submit}>
      <div className="login-brand"><span className="login-eye">◉</span><div><b>VISION <span>AI</span></b><small>CONSOLA DE ANÁLISIS</small></div></div>
      <h1>Iniciar sesión</h1>
      <p>Accede con tu correo corporativo para revisar escenas, alertas e historial.</p>
      <label htmlFor="email">Correo</label>
      <input id="email" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required placeholder="nombre@empresa.com" />
      <label htmlFor="password">Contraseña</label>
      <input id="password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required />
      {error && <div className="login-error" role="alert">{error}</div>}
      <button type="submit" disabled={busy}>{busy ? 'Ingresando…' : 'Ingresar'}</button>
      {showDemo && <div className="demo-users">
        <small>Usuarios de prueba (clic para rellenar)</small>
        {demoUsers.map(([e, p, r]) => <button type="button" key={e} className="secondary" onClick={() => { setEmail(e); setPassword(p) }}>{r} · {e}</button>)}
      </div>}
    </form>
  </div>;
}

export default function AuthGate() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checking, setChecking] = useState(() => Boolean(getToken()));
  const logout = () => { setToken(null); setUser(null) };
  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (!getToken()) return;
    api<{ user: SessionUser }>('/api/auth/me').then(r => setUser(r.user)).catch(() => setToken(null)).finally(() => setChecking(false));
  }, []);
  if (checking) return <div className="login-page"><div className="login-card"><p>Verificando sesión…</p></div></div>;
  if (!user) return <Login onLogin={setUser} />;
  return <App user={user} onLogout={logout} />;
}

export { roleNames };

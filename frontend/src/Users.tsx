import { useEffect, useState, type FormEvent } from 'react';
import { api, post, patch, del, roleNames, type AppUser, type Role, type SessionUser } from './api';

const roles: Role[] = ['admin', 'supervisor', 'operador', 'auditor'];
const roleHelp: Record<Role, string> = {
  admin: 'Todo: usuarios, limpieza de datos, revisión de alertas',
  supervisor: 'Registra eventos y análisis, revisa alertas',
  operador: 'Registra eventos 3D y análisis de imágenes',
  auditor: 'Solo lectura y exportación CSV',
};

export function UsersPanel({ me, notify }: { me: SessionUser; notify: (m: string) => void }) {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [form, setForm] = useState({ name: '', email: '', role: 'operador' as Role, password: '' });
  const isAdmin = me.permissions.includes('users:manage');
  const load = () => { if (isAdmin) api<AppUser[]>('/api/users').then(setUsers).catch(e => notify(e.message)) };
  useEffect(load, [isAdmin]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    try { await post('/api/users', form); notify('Usuario creado: ' + form.email); setForm({ name: '', email: '', role: 'operador', password: '' }); load() }
    catch (err) { notify((err as Error).message) }
  };
  const update = async (u: AppUser, data: Partial<AppUser> & { password?: string }) => {
    try { await patch('/api/users/' + u.id, data); load() } catch (err) { notify((err as Error).message) }
  };
  const resetPassword = (u: AppUser) => {
    const p = prompt('Nueva contraseña para ' + u.email + ' (mínimo 8 caracteres)');
    if (p) update(u, { password: p }).then(() => notify('Contraseña actualizada para ' + u.email));
  };
  const remove = async (u: AppUser) => {
    if (!confirm('¿Eliminar a ' + u.email + '?')) return;
    try { await del('/api/users/' + u.id); notify('Usuario eliminado'); load() } catch (err) { notify((err as Error).message) }
  };

  return <>
    <section className="panel">
      <h3>Usuarios y roles</h3>
      <div className="role-grid">{roles.map(r => <div key={r} className={'role-card ' + (me.role === r ? 'mine' : '')}><strong>{roleNames[r]}</strong><small>{roleHelp[r]}</small></div>)}</div>
      {!isAdmin && <p className="rule">Has iniciado sesión como <b>{me.name}</b> ({roleNames[me.role]}). Solo un administrador puede gestionar usuarios.</p>}
    </section>
    {isAdmin && <>
      <section className="panel" style={{ marginTop: 16 }}>
        <h3>Crear usuario</h3>
        <form className="user-form" onSubmit={create}>
          <input placeholder="Nombre" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
          <input placeholder="correo@empresa.com" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required />
          <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value as Role })}>{roles.map(r => <option key={r} value={r}>{roleNames[r]}</option>)}</select>
          <input placeholder="Contraseña (mín. 8)" type="password" minLength={8} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required />
          <button type="submit">Crear</button>
        </form>
      </section>
      <section className="panel" style={{ marginTop: 16 }}>
        <h3>Usuarios registrados ({users.length})</h3>
        <div className="tablewrap"><table><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estado</th><th>Último acceso</th><th></th></tr></thead><tbody>
          {users.map(u => <tr key={u.id}>
            <td><strong>{u.name}</strong></td><td>{u.email}</td>
            <td><select className="mini" value={u.role} disabled={u.id === me.id} onChange={e => update(u, { role: e.target.value as Role })}>{roles.map(r => <option key={r} value={r}>{roleNames[r]}</option>)}</select></td>
            <td><span className={'event-pill ' + (u.active ? 'event-info' : 'event-warning')}>{u.active ? 'Activo' : 'Inactivo'}</span></td>
            <td>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('es-PE', { hour12: false }) : '—'}</td>
            <td className="row-actions">
              <button className="secondary" onClick={() => resetPassword(u)}>Contraseña</button>
              {u.id !== me.id && <button className="secondary" onClick={() => update(u, { active: !u.active })}>{u.active ? 'Desactivar' : 'Activar'}</button>}
              {u.id !== me.id && <button className="secondary danger" onClick={() => remove(u)}>Eliminar</button>}
            </td>
          </tr>)}
        </tbody></table></div>
      </section>
    </>}
  </>;
}

export function ChangePassword({ notify }: { notify: (m: string) => void }) {
  const [cur, setCur] = useState(''); const [next, setNext] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try { await post('/api/auth/change-password', { currentPassword: cur, newPassword: next }); setCur(''); setNext(''); notify('Contraseña actualizada') }
    catch (err) { notify((err as Error).message) }
  };
  return <form className="user-form" onSubmit={submit}>
    <input type="password" placeholder="Contraseña actual" autoComplete="current-password" value={cur} onChange={e => setCur(e.target.value)} required />
    <input type="password" placeholder="Nueva contraseña (mín. 8)" autoComplete="new-password" minLength={8} value={next} onChange={e => setNext(e.target.value)} required />
    <button type="submit">Cambiar contraseña</button>
  </form>;
}

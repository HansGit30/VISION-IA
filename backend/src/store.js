// Capa de datos con dos implementaciones:
//  - PostgreSQL (Supabase) cuando existe DATABASE_URL
//  - Archivo JSON local (backend/data/db.json) cuando no existe: ideal para correr en tu PC
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from './config.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const publicUser = u => u && ({
  id: u.id, email: u.email, name: u.name, role: u.role, active: u.active,
  createdAt: u.created_at ?? u.createdAt, lastLoginAt: u.last_login_at ?? u.lastLoginAt ?? null,
});
const eventOut = r => ({
  id: r.id, sector: r.sector, objectId: r.object_id ?? r.objectId, label: r.label,
  confidence: Number(r.confidence), distance: Number(r.distance),
  at: new Date(r.at).toISOString(), status: r.status, severity: r.severity,
  createdBy: r.created_by_name ?? r.createdByName ?? null,
});
const analysisOut = r => ({
  id: r.id, at: new Date(r.at).toISOString(), sector: r.sector, source: r.source, mode: r.mode,
  detections: r.detections, durationMs: r.duration_ms ?? r.durationMs, status: r.status,
  createdBy: r.created_by_name ?? r.createdByName ?? null,
});

/* ------------------------------ PostgreSQL ------------------------------ */
function pgStore() {
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    ssl: /localhost|127\.0\.0\.1/.test(config.databaseUrl) ? false : { rejectUnauthorized: false },
    max: 5,
  });
  const q = (text, params) => pool.query(text, params).then(r => r.rows);
  return {
    kind: 'postgres',
    async init() {
      const sql = fs.readFileSync(path.join(here, 'schema.sql'), 'utf8');
      await pool.query(sql);
    },
    users: {
      count: async () => Number((await q('select count(*)::int as n from app_users'))[0].n),
      list: async () => (await q('select * from app_users order by created_at')).map(publicUser),
      findByEmail: async email => (await q('select * from app_users where lower(email)=lower($1)', [email]))[0],
      findById: async id => (await q('select * from app_users where id=$1', [id]))[0],
      create: async u => publicUser((await q(
        'insert into app_users(email,name,role,password_hash,active) values($1,$2,$3,$4,$5) returning *',
        [u.email, u.name, u.role, u.passwordHash, u.active ?? true]))[0]),
      update: async (id, p) => {
        const cur = (await q('select * from app_users where id=$1', [id]))[0];
        if (!cur) return null;
        return publicUser((await q(
          'update app_users set name=$2, role=$3, active=$4, password_hash=$5 where id=$1 returning *',
          [id, p.name ?? cur.name, p.role ?? cur.role, p.active ?? cur.active, p.passwordHash ?? cur.password_hash]))[0]);
      },
      touchLogin: id => q('update app_users set last_login_at=now() where id=$1', [id]),
      remove: async id => (await pool.query('delete from app_users where id=$1', [id])).rowCount > 0,
    },
    events: {
      list: async (limit = 1000) => (await q(
        `select e.*, u.name as created_by_name from events e left join app_users u on u.id=e.created_by
         order by e.at desc limit $1`, [limit])).map(eventOut),
      insertMany: async (rows, userId) => {
        for (const r of rows) {
          await q(`insert into events(id,sector,object_id,label,confidence,distance,at,status,severity,created_by)
                   values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict (id) do nothing`,
            [r.id, r.sector, r.objectId, r.label, r.confidence, r.distance, r.at, r.status || 'nueva', r.severity || 'info', userId]);
        }
        return rows.length;
      },
      setStatus: async (id, status, userId) => (await pool.query(
        'update events set status=$2, reviewed_by=$3 where id=$1', [id, status, userId])).rowCount > 0,
      clear: () => q('delete from events'),
    },
    analyses: {
      list: async (limit = 200) => (await q(
        `select a.*, u.name as created_by_name from analyses a left join app_users u on u.id=a.created_by
         order by a.at desc limit $1`, [limit])).map(analysisOut),
      insert: async (a, userId) => q(
        `insert into analyses(id,at,sector,source,mode,detections,duration_ms,status,created_by)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (id) do nothing`,
        [a.id, a.at, a.sector, a.source, a.mode, JSON.stringify(a.detections || []), a.durationMs || 0, a.status || 'COMPLETADO', userId]),
      clear: () => q('delete from analyses'),
    },
  };
}

/* ------------------------------ Archivo JSON ------------------------------ */
function jsonStore() {
  const file = process.env.DATA_FILE || path.join(here, '..', 'data', 'db.json');
  let db = { users: [], events: [], analyses: [] };
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(db, null, 1));
    fs.renameSync(file + '.tmp', file);
  };
  const nameOf = id => db.users.find(u => u.id === id)?.name ?? null;
  return {
    kind: 'json',
    file,
    async init() {
      if (fs.existsSync(file)) db = { users: [], events: [], analyses: [], ...JSON.parse(fs.readFileSync(file, 'utf8')) };
      else save();
    },
    users: {
      count: async () => db.users.length,
      list: async () => db.users.map(publicUser),
      findByEmail: async email => db.users.find(u => u.email.toLowerCase() === String(email).toLowerCase()),
      findById: async id => db.users.find(u => u.id === id),
      create: async u => {
        const row = { id: crypto.randomUUID(), email: u.email, name: u.name, role: u.role, password_hash: u.passwordHash,
          active: u.active ?? true, created_at: new Date().toISOString(), last_login_at: null };
        db.users.push(row); save(); return publicUser(row);
      },
      update: async (id, p) => {
        const u = db.users.find(x => x.id === id); if (!u) return null;
        if (p.name !== undefined) u.name = p.name;
        if (p.role !== undefined) u.role = p.role;
        if (p.active !== undefined) u.active = p.active;
        if (p.passwordHash) u.password_hash = p.passwordHash;
        save(); return publicUser(u);
      },
      touchLogin: async id => { const u = db.users.find(x => x.id === id); if (u) { u.last_login_at = new Date().toISOString(); save(); } },
      remove: async id => { const n = db.users.length; db.users = db.users.filter(u => u.id !== id); save(); return db.users.length < n; },
    },
    events: {
      list: async (limit = 1000) => [...db.events].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit)
        .map(e => eventOut({ ...e, createdByName: nameOf(e.createdBy) })),
      insertMany: async (rows, userId) => {
        const ids = new Set(db.events.map(e => e.id));
        for (const r of rows) if (!ids.has(r.id)) db.events.push({ ...r, status: r.status || 'nueva', severity: r.severity || 'info', createdBy: userId });
        if (db.events.length > 5000) db.events = db.events.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5000);
        save(); return rows.length;
      },
      setStatus: async (id, status, userId) => {
        const e = db.events.find(x => x.id === id); if (!e) return false;
        e.status = status; e.reviewedBy = userId; save(); return true;
      },
      clear: async () => { db.events = []; save(); },
    },
    analyses: {
      list: async (limit = 200) => [...db.analyses].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit)
        .map(a => analysisOut({ ...a, createdByName: nameOf(a.createdBy) })),
      insert: async (a, userId) => { if (!db.analyses.some(x => x.id === a.id)) { db.analyses.push({ ...a, createdBy: userId }); save(); } },
      clear: async () => { db.analyses = []; save(); },
    },
  };
}

export const store = config.databaseUrl ? pgStore() : jsonStore();

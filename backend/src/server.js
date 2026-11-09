
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import { config } from './config.js';
import { store } from './store.js';
import { seedUsers } from './seed.js';

const ROLES = ['admin', 'supervisor', 'operador', 'auditor'];

const PERMISSIONS = {
  'data:read': ['admin', 'supervisor', 'operador', 'auditor'],
  'data:write': ['admin', 'supervisor', 'operador'],
  'alerts:review': ['admin', 'supervisor'],
  'data:clear': ['admin'],
  'users:manage': ['admin'],
};

const permissionsFor = role =>
  Object.keys(PERMISSIONS).filter(p => PERMISSIONS[p].includes(role));

const app = express();

app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);

    const ok = config.corsOrigins.some(o =>
      o === '*' ||
      o === origin ||
      (o.startsWith('*.') && origin.endsWith(o.slice(1))) ||
      (
        o.includes('://*.') &&
        origin.startsWith(o.split('://')[0] + '://') &&
        origin.endsWith(o.split('://*')[1])
      )
    );

    cb(
      ok ? null : new Error('Origen no permitido por CORS: ' + origin),
      ok
    );
  },
}));

const wrap = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/* =====================================================
   CONTROL DE INTENTOS DE LOGIN
===================================================== */

const attempts = new Map();

function tooManyAttempts(key) {
  const now = Date.now();
  const win = 15 * 60 * 1000;

  const list = (attempts.get(key) || [])
    .filter(t => now - t < win);

  attempts.set(key, list);
  return list.length >= 10;
}

const recordFail = key =>
  attempts.set(key, [...(attempts.get(key) || []), Date.now()]);

/* =====================================================
   AUTENTICACIÓN JWT
===================================================== */

async function auth(req, res, next) {
  const token = (req.headers.authorization || '')
    .replace(/^Bearer\s+/i, '');

  if (!token) {
    return res.status(401).json({
      error: 'Sesión requerida'
    });
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const user = await store.users.findById(payload.sub);

    if (!user || !user.active) {
      return res.status(401).json({
        error: 'Usuario inactivo o inexistente'
      });
    }

    req.user = user;
    next();

  } catch {
    return res.status(401).json({
      error: 'Sesión expirada, vuelve a iniciar sesión'
    });
  }
}

const can = perm => (req, res, next) =>
  PERMISSIONS[perm].includes(req.user.role)
    ? next()
    : res.status(403).json({
        error: 'Tu rol no tiene permiso para esta acción'
      });

const me = u => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  permissions: permissionsFor(u.role)
});

/* =====================================================
   ESTADO DEL SERVIDOR
===================================================== */

app.get('/', (_req, res) => {
  res.json({
    name: 'VISION AI API',
    status: 'ok',
    docs: '/api/health'
  });
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    storage: store.kind,
    time: new Date().toISOString()
  });
});

/* =====================================================
   YOLO - DETECCIÓN, SEGMENTACIÓN Y CALIDAD
===================================================== */

app.post(
  [
    '/api/yolo/detect',
    '/api/yolo/segment',
    '/api/yolo/quality'
  ],
  auth,
  can('data:write'),
  express.raw({
    type: [
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/octet-stream'
    ],
    limit: '12mb'
  }),
  wrap(async (req, res) => {

    if (!Buffer.isBuffer(req.body) || !req.body.length) {
      return res.status(400).json({
        error: 'Envía una imagen válida'
      });
    }

    let endpoint = '/detect';

    if (req.path.endsWith('/segment')) {
      endpoint = '/segment';
    }

    if (req.path.endsWith('/quality')) {
      endpoint = '/quality';
    }

    const confidenceInput = Number(req.query.confidence);

    const confidence = Number.isFinite(confidenceInput)
      ? Math.max(0.01, Math.min(0.99, confidenceInput))
      : 0.25;

    const controller = new AbortController();

    const timeout = setTimeout(
      () => controller.abort(),
      120000
    );

    try {
      const baseUrl =
        process.env.YOLO_SERVICE_URL ||
        'http://127.0.0.1:8000';

      const url = new URL(endpoint, baseUrl);

      url.searchParams.set(
        'confidence',
        String(confidence)
      );

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type':
            req.headers['content-type'] ||
            'application/octet-stream'
        },
        body: req.body,
        signal: controller.signal
      });

      const contentType =
        response.headers.get('content-type') || '';

      const data = contentType.includes('application/json')
        ? await response.json()
        : {
            error: 'Respuesta no JSON del servicio YOLO',
            detail: (await response.text()).slice(0, 300)
          };

      return res.status(response.status).json(data);

    } catch (err) {
      return res.status(503).json({
        error: 'Servicio de inferencia no disponible',
        detail: err.message
      });

    } finally {
      clearTimeout(timeout);
    }
  })
);

/* =====================================================
   LOGIN
===================================================== */

app.post('/api/auth/login', wrap(async (req, res) => {
  const email = String(req.body?.email || '').trim();
  const password = String(req.body?.password || '');

  const key = req.ip + '|' + email.toLowerCase();

  if (tooManyAttempts(key)) {
    return res.status(429).json({
      error: 'Demasiados intentos. Espera 15 minutos.'
    });
  }

  const user = email &&
    await store.users.findByEmail(email);

  if (
    !user ||
    !user.active ||
    !(await bcrypt.compare(password, user.password_hash))
  ) {
    recordFail(key);

    return res.status(401).json({
      error: 'Correo o contraseña incorrectos'
    });
  }

  attempts.delete(key);

  await store.users.touchLogin(user.id);

  const token = jwt.sign(
    {
      sub: user.id,
      role: user.role
    },
    config.jwtSecret,
    {
      expiresIn: config.jwtExpiresIn
    }
  );

  res.json({
    token,
    user: me(user)
  });
}));

/* =====================================================
   USUARIO ACTUAL
===================================================== */

app.get('/api/auth/me', auth, (req, res) => {
  res.json({
    user: me(req.user)
  });
});

/* =====================================================
   CAMBIAR CONTRASEÑA
===================================================== */

app.post(
  '/api/auth/change-password',
  auth,
  wrap(async (req, res) => {

    const {
      currentPassword,
      newPassword
    } = req.body || {};

    const valid = await bcrypt.compare(
      String(currentPassword || ''),
      req.user.password_hash
    );

    if (!valid) {
      return res.status(400).json({
        error: 'La contraseña actual no es correcta'
      });
    }

    if (String(newPassword || '').length < 8) {
      return res.status(400).json({
        error: 'La nueva contraseña debe tener al menos 8 caracteres'
      });
    }

    await store.users.update(req.user.id, {
      passwordHash: await bcrypt.hash(newPassword, 10)
    });

    res.json({ ok: true });
  })
);

/* =====================================================
   HISTORIAL DE EVENTOS
===================================================== */

app.get(
  '/api/events',
  auth,
  can('data:read'),
  wrap(async (_req, res) => {
    res.json(await store.events.list(1000));
  })
);

/* =====================================================
   REGISTRAR EVENTOS
===================================================== */

app.post(
  '/api/events',
  auth,
  can('data:write'),
  wrap(async (req, res) => {

    const rows = (
      Array.isArray(req.body)
        ? req.body
        : [req.body]
    ).slice(0, 100);

    const clean = rows
      .filter(r =>
        r &&
        r.id &&
        r.sector &&
        r.objectId &&
        r.label &&
        r.at
      )
      .map(r => ({
        id: String(r.id).slice(0, 80),
        sector: String(r.sector),
        objectId: String(r.objectId),
        label: String(r.label).slice(0, 200),
        confidence: Number(r.confidence) || 0,
        distance: Number(r.distance) || 0,
        at: new Date(r.at).toISOString(),
        status:
          r.status === 'revisada'
            ? 'revisada'
            : 'nueva',
        severity:
          r.severity === 'warning'
            ? 'warning'
            : 'info'
      }));

    await store.events.insertMany(
      clean,
      req.user.id
    );

    res.status(201).json({
      inserted: clean.length
    });
  })
);

/* =====================================================
   REVISAR EVENTOS
===================================================== */

app.patch(
  '/api/events/:id',
  auth,
  can('alerts:review'),
  wrap(async (req, res) => {

    const status =
      req.body?.status === 'nueva'
        ? 'nueva'
        : 'revisada';

    const ok = await store.events.setStatus(
      req.params.id,
      status,
      req.user.id
    );

    if (!ok) {
      return res.status(404).json({
        error: 'Evento no encontrado'
      });
    }

    res.json({ ok: true });
  })
);

/* =====================================================
   ANÁLISIS DE IMÁGENES
===================================================== */

app.get(
  '/api/analyses',
  auth,
  can('data:read'),
  wrap(async (_req, res) => {
    res.json(await store.analyses.list(200));
  })
);

/* =====================================================
   GUARDAR ANÁLISIS
===================================================== */

app.post(
  '/api/analyses',
  auth,
  can('data:write'),
  wrap(async (req, res) => {

    const a = req.body || {};

    if (!a.id || !a.sector) {
      return res.status(400).json({
        error: 'Datos incompletos'
      });
    }

    await store.analyses.insert({
      id: String(a.id).slice(0, 80),
      at: new Date(a.at || Date.now()).toISOString(),
      sector: String(a.sector),
      source: String(a.source || 'imagen').slice(0, 200),
      mode: String(a.mode || 'deteccion'),
      detections: Array.isArray(a.detections)
        ? a.detections.slice(0, 200)
        : [],
      durationMs: Number(a.durationMs) || 0,
      status: String(a.status || 'COMPLETADO')
    }, req.user.id);

    res.status(201).json({
      ok: true
    });
  })
);

/* =====================================================
   ELIMINAR DATOS
===================================================== */

app.delete(
  '/api/data',
  auth,
  can('data:clear'),
  wrap(async (_req, res) => {

    await store.events.clear();
    await store.analyses.clear();

    res.json({ ok: true });
  })
);

/* =====================================================
   LISTAR USUARIOS
===================================================== */

app.get(
  '/api/users',
  auth,
  can('users:manage'),
  wrap(async (_req, res) => {
    res.json(await store.users.list());
  })
);

/* =====================================================
   CREAR USUARIOS
===================================================== */

app.post(
  '/api/users',
  auth,
  can('users:manage'),
  wrap(async (req, res) => {

    const {
      email,
      name,
      role,
      password
    } = req.body || {};

    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
        String(email || '')
      )
    ) {
      return res.status(400).json({
        error: 'Correo no válido'
      });
    }

    if (!ROLES.includes(role)) {
      return res.status(400).json({
        error: 'Rol no válido'
      });
    }

    if (String(password || '').length < 8) {
      return res.status(400).json({
        error: 'La contraseña debe tener al menos 8 caracteres'
      });
    }

    if (await store.users.findByEmail(email)) {
      return res.status(409).json({
        error: 'Ya existe un usuario con ese correo'
      });
    }

    const user = await store.users.create({
      email: String(email).trim(),
      name: String(name || email).trim(),
      role,
      passwordHash: await bcrypt.hash(password, 10)
    });

    res.status(201).json(user);
  })
);

/* =====================================================
   ACTUALIZAR USUARIOS
===================================================== */

app.patch(
  '/api/users/:id',
  auth,
  can('users:manage'),
  wrap(async (req, res) => {

    const {
      name,
      role,
      active,
      password
    } = req.body || {};

    if (
      role !== undefined &&
      !ROLES.includes(role)
    ) {
      return res.status(400).json({
        error: 'Rol no válido'
      });
    }

    if (
      req.params.id === req.user.id &&
      (
        active === false ||
        (role && role !== 'admin')
      )
    ) {
      return res.status(400).json({
        error: 'No puedes desactivarte ni quitarte el rol de administrador'
      });
    }

    if (
      password !== undefined &&
      String(password).length < 8
    ) {
      return res.status(400).json({
        error: 'La contraseña debe tener al menos 8 caracteres'
      });
    }

    const user = await store.users.update(
      req.params.id,
      {
        name,
        role,
        active:
          active === undefined
            ? undefined
            : Boolean(active),
        passwordHash: password
          ? await bcrypt.hash(password, 10)
          : undefined
      }
    );

    if (!user) {
      return res.status(404).json({
        error: 'Usuario no encontrado'
      });
    }

    res.json(user);
  })
);

/* =====================================================
   ELIMINAR USUARIOS
===================================================== */

app.delete(
  '/api/users/:id',
  auth,
  can('users:manage'),
  wrap(async (req, res) => {

    if (req.params.id === req.user.id) {
      return res.status(400).json({
        error: 'No puedes eliminar tu propio usuario'
      });
    }

    const removed = await store.users.remove(
      req.params.id
    );

    if (!removed) {
      return res.status(404).json({
        error: 'Usuario no encontrado'
      });
    }

    res.json({ ok: true });
  })
);

/* =====================================================
   RUTAS NO ENCONTRADAS
===================================================== */

app.use((_req, res) => {
  res.status(404).json({
    error: 'Ruta no encontrada'
  });
});

/* =====================================================
   MANEJO DE ERRORES
===================================================== */

app.use((err, _req, res, _next) => {
  console.error(err);

  const status =
    err.message?.startsWith('Origen no permitido')
      ? 403
      : err.status || err.statusCode || 500;

  res.status(status).json({
    error: err.message || 'Error interno'
  });
});

/* =====================================================
   INICIALIZACIÓN DE SUPABASE / ALMACENAMIENTO
===================================================== */

if (config.isProd && store.kind === 'json') {
  console.warn(
    'AVISO: producción sin DATABASE_URL. ' +
    'Configura Supabase para conservar los datos.'
  );
}

await store.init();

if (await seedUsers()) {
  console.log('Usuarios iniciales creados.');
}

/* =====================================================
   INICIAR SERVIDOR EXPRESS
===================================================== */

app.listen(config.port, () => {
  console.log(
    `VISION AI API escuchando en http://localhost:${config.port}`
  );

  console.log(
    `Almacenamiento: ${
      store.kind === 'postgres'
        ? 'PostgreSQL (Supabase)'
        : 'archivo JSON local'
    }`
  );

  console.log(
    'YOLO SERVICE: ' +
    (process.env.YOLO_SERVICE_URL || 'http://127.0.0.1:8000')
  );

  console.log(
    'Rutas YOLO disponibles: /detect, /segment, /quality'
  );
});

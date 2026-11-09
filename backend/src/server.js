
import 'dotenv/config';

import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import { config } from './config.js';
import { store } from './store.js';
import { seedUsers } from './seed.js';

// ======================================================
// CONFIGURACIÓN GENERAL
// ======================================================

const app = express();

const ROLES = [
  'admin',
  'supervisor',
  'operador',
  'auditor'
];

const PERMISSIONS = {
  'data:read': ROLES,
  'data:write': ['admin', 'supervisor', 'operador'],
  'alerts:review': ['admin', 'supervisor'],
  'data:clear': ['admin'],
  'users:manage': ['admin']
};

const YOLO_SERVICE_URL = (
  process.env.YOLO_SERVICE_URL ||
  'http://127.0.0.1:8000'
).replace(/\/+$/, '');

const YOLO_TIMEOUT_MS = 180000;

app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(express.json({
  limit: '2mb'
}));

// ======================================================
// CORS - VERCEL Y DESARROLLO LOCAL
// ======================================================

app.use(cors({
  origin(origin, callback) {
    if (!origin) {
      return callback(null, true);
    }

    const allowed = config.corsOrigins.some(value => {
      const item = value.trim();

      if (item === '*' || item === origin) {
        return true;
      }

      if (item.startsWith('*.')) {
        const hostname = new URL(origin).hostname;
        const suffix = item.slice(1);

        return hostname.endsWith(suffix);
      }

      if (item.includes('://*.')) {
        const [protocol, domain] = item.split('://*.');
        const url = new URL(origin);

        return (
          url.protocol === protocol + ':' &&
          url.hostname.endsWith('.' + domain)
        );
      }

      return false;
    });

    if (!allowed) {
      console.warn('[CORS] Origen rechazado:', origin);
      return callback(
        new Error('Origen no permitido por CORS: ' + origin)
      );
    }

    callback(null, true);
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

const wrap = fn => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// ======================================================
// PERMISOS
// ======================================================

function permissionsFor(role) {
  return Object.keys(PERMISSIONS).filter(permission =>
    PERMISSIONS[permission].includes(role)
  );
}

function can(permission) {
  return (req, res, next) => {
    if (!PERMISSIONS[permission]?.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Tu rol no tiene permiso para esta acción'
      });
    }

    next();
  };
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    permissions: permissionsFor(user.role)
  };
}

// ======================================================
// CONTROL DE INTENTOS DE LOGIN
// ======================================================

const loginAttempts = new Map();

function getAttempts(key) {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;

  const attempts = (loginAttempts.get(key) || [])
    .filter(time => now - time < windowMs);

  if (attempts.length) {
    loginAttempts.set(key, attempts);
  } else {
    loginAttempts.delete(key);
  }

  return attempts;
}

function recordFailedLogin(key) {
  const attempts = getAttempts(key);
  attempts.push(Date.now());
  loginAttempts.set(key, attempts);
}

// ======================================================
// AUTENTICACIÓN JWT
// ======================================================

async function auth(req, res, next) {
  const authorization = req.headers.authorization || '';

  const token = authorization.replace(/^Bearer\s+/i, '');

  if (!token) {
    return res.status(401).json({
      error: 'Sesión requerida'
    });
  }

  let payload;

  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    return res.status(401).json({
      error: 'Sesión expirada. Vuelve a iniciar sesión.'
    });
  }

  try {
    const user = await store.users.findById(payload.sub);

    if (!user || !user.active) {
      return res.status(401).json({
        error: 'Usuario inactivo o inexistente'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

// ======================================================
// ESTADO DEL BACKEND
// ======================================================

app.get('/', (_req, res) => {
  res.json({
    name: 'VISION AI API',
    status: 'ok',
    health: '/api/health'
  });
});

app.get('/api/health', (_req, res) => {
  res.set('Cache-Control', 'no-store');

  res.json({
    ok: true,
    service: 'VISION AI Backend',
    storage: store.kind,
    yoloConfigured: Boolean(YOLO_SERVICE_URL),
    time: new Date().toISOString()
  });
});

// ======================================================
// YOLO - DETECCIÓN, SEGMENTACIÓN Y CALIDAD
// ======================================================

const imageParser = express.raw({
  type: [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/octet-stream'
  ],
  limit: '12mb'
});

app.post(
  [
    '/api/yolo/detect',
    '/api/yolo/segment',
    '/api/yolo/quality'
  ],
  auth,
  can('data:write'),
  imageParser,
  wrap(async (req, res) => {

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({
        error: 'Debes enviar una imagen válida.'
      });
    }

    const endpoint = req.path.endsWith('/segment')
      ? '/segment'
      : req.path.endsWith('/quality')
        ? '/quality'
        : '/detect';

    const rawConfidence = req.query.confidence;
    const parsedConfidence = Number(rawConfidence);

    const confidence = (
      rawConfidence !== undefined &&
      rawConfidence !== '' &&
      Number.isFinite(parsedConfidence)
    )
      ? Math.max(0.01, Math.min(0.99, parsedConfidence))
      : 0.25;

    const url = new URL(YOLO_SERVICE_URL + endpoint);

    url.searchParams.set(
      'confidence',
      String(confidence)
    );

    const controller = new AbortController();
    const started = Date.now();

    const timeout = setTimeout(() => {
      controller.abort();
    }, YOLO_TIMEOUT_MS);

    console.log('[YOLO] Iniciando análisis:', {
      endpoint,
      bytes: req.body.length,
      confidence,
      service: YOLO_SERVICE_URL
    });

    try {
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

      const responseText = await response.text();

      let data;

      if (contentType.includes('application/json')) {
        try {
          data = JSON.parse(responseText);
        } catch {
          data = {
            error: 'Respuesta JSON inválida del servicio YOLO'
          };
        }
      } else {
        data = {
          error: response.ok
            ? 'Respuesta inesperada del servicio YOLO'
            : 'El servicio YOLO devolvió un error HTTP',
          detail: responseText.slice(0, 500)
        };
      }

      const durationMs = Date.now() - started;

      console.log('[YOLO] Respuesta:', {
        endpoint,
        status: response.status,
        durationMs
      });

      if (!response.ok) {
        console.error('[YOLO] Error del servicio:', {
          status: response.status,
          endpoint,
          detail: data.detail || data.error
        });
      }

      return res.status(response.status).json(data);

    } catch (error) {
      const durationMs = Date.now() - started;
      const aborted = controller.signal.aborted;

      console.error('[YOLO PROXY ERROR]', {
        endpoint,
        name: error.name,
        message: error.message,
        cause: error.cause?.message || null,
        aborted,
        durationMs
      });

      if (res.headersSent) {
        return;
      }

      return res.status(aborted ? 504 : 503).json({
        ok: false,
        error: aborted
          ? 'Tiempo de espera agotado durante el análisis'
          : 'Servicio de inferencia no disponible',
        detail: error.message,
        endpoint,
        durationMs
      });

    } finally {
      clearTimeout(timeout);
    }
  })
);

// ======================================================
// INICIAR SESIÓN
// ======================================================

app.post('/api/auth/login', wrap(async (req, res) => {
  const email = String(req.body?.email || '')
    .trim()
    .toLowerCase();

  const password = String(req.body?.password || '');

  const key = req.ip + '|' + email;

  if (getAttempts(key).length >= 10) {
    return res.status(429).json({
      error: 'Demasiados intentos. Espera 15 minutos.'
    });
  }

  const user = email
    ? await store.users.findByEmail(email)
    : null;

  const validPassword = user && user.active
    ? await bcrypt.compare(password, user.password_hash)
    : false;

  if (!user || !user.active || !validPassword) {
    recordFailedLogin(key);

    return res.status(401).json({
      error: 'Correo o contraseña incorrectos'
    });
  }

  loginAttempts.delete(key);

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

  return res.json({
    token,
    user: publicUser(user)
  });
}));

// ======================================================
// USUARIO ACTUAL
// ======================================================

app.get('/api/auth/me', auth, (req, res) => {
  res.json({
    user: publicUser(req.user)
  });
});

// ======================================================
// CAMBIAR CONTRASEÑA
// ======================================================

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

    return res.json({ ok: true });
  })
);

// ======================================================
// HISTORIAL DE EVENTOS
// ======================================================

app.get(
  '/api/events',
  auth,
  can('data:read'),
  wrap(async (_req, res) => {
    res.json(await store.events.list(1000));
  })
);

// ======================================================
// REGISTRAR EVENTOS
// ======================================================

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

    const clean = [];

    for (const row of rows) {
      if (
        !row ||
        !row.id ||
        !row.sector ||
        !row.objectId ||
        !row.label ||
        !row.at
      ) {
        continue;
      }

      const date = new Date(row.at);

      if (Number.isNaN(date.getTime())) {
        continue;
      }

      clean.push({
        id: String(row.id).slice(0, 80),
        sector: String(row.sector),
        objectId: String(row.objectId),
        label: String(row.label).slice(0, 200),
        confidence: Number(row.confidence) || 0,
        distance: Number(row.distance) || 0,
        at: date.toISOString(),
        status: row.status === 'revisada'
          ? 'revisada'
          : 'nueva',
        severity: row.severity === 'warning'
          ? 'warning'
          : 'info'
      });
    }

    if (!clean.length) {
      return res.status(400).json({
        error: 'No se recibieron eventos válidos'
      });
    }

    await store.events.insertMany(
      clean,
      req.user.id
    );

    return res.status(201).json({
      inserted: clean.length
    });
  })
);

// ======================================================
// REVISAR EVENTOS
// ======================================================

app.patch(
  '/api/events/:id',
  auth,
  can('alerts:review'),
  wrap(async (req, res) => {

    const status = req.body?.status === 'nueva'
      ? 'nueva'
      : 'revisada';

    const updated = await store.events.setStatus(
      req.params.id,
      status,
      req.user.id
    );

    if (!updated) {
      return res.status(404).json({
        error: 'Evento no encontrado'
      });
    }

    return res.json({ ok: true });
  })
);

// ======================================================
// LISTAR ANÁLISIS
// ======================================================

app.get(
  '/api/analyses',
  auth,
  can('data:read'),
  wrap(async (_req, res) => {
    res.json(await store.analyses.list(200));
  })
);

// ======================================================
// GUARDAR ANÁLISIS
// ======================================================

app.post(
  '/api/analyses',
  auth,
  can('data:write'),
  wrap(async (req, res) => {

    const analysis = req.body || {};

    if (!analysis.id || !analysis.sector) {
      return res.status(400).json({
        error: 'Datos incompletos del análisis'
      });
    }

    const date = new Date(analysis.at || Date.now());

    if (Number.isNaN(date.getTime())) {
      return res.status(400).json({
        error: 'Fecha de análisis inválida'
      });
    }

    await store.analyses.insert({
      id: String(analysis.id).slice(0, 80),
      at: date.toISOString(),
      sector: String(analysis.sector),
      source: String(
        analysis.source || 'imagen'
      ).slice(0, 200),
      mode: String(analysis.mode || 'deteccion'),
      detections: Array.isArray(analysis.detections)
        ? analysis.detections.slice(0, 200)
        : [],
      durationMs: Number(analysis.durationMs) || 0,
      status: String(
        analysis.status || 'COMPLETADO'
      )
    }, req.user.id);

    return res.status(201).json({
      ok: true
    });
  })
);

// ======================================================
// ELIMINAR HISTORIAL
// ======================================================

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

// ======================================================
// LISTAR USUARIOS
// ======================================================

app.get(
  '/api/users',
  auth,
  can('users:manage'),
  wrap(async (_req, res) => {
    res.json(await store.users.list());
  })
);

// ======================================================
// CREAR USUARIOS
// ======================================================

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

    const normalizedEmail = String(email || '')
      .trim()
      .toLowerCase();

    const validEmail =
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail);

    if (!validEmail) {
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

    if (await store.users.findByEmail(normalizedEmail)) {
      return res.status(409).json({
        error: 'Ya existe un usuario con ese correo'
      });
    }

    const user = await store.users.create({
      email: normalizedEmail,
      name: String(name || normalizedEmail).trim(),
      role,
      passwordHash: await bcrypt.hash(password, 10)
    });

    return res.status(201).json(user);
  })
);

// ======================================================
// ACTUALIZAR USUARIOS
// ======================================================

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
      String(req.params.id) === String(req.user.id) &&
      (
        active === false ||
        (role !== undefined && role !== 'admin')
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
        active: active === undefined
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

    return res.json(user);
  })
);

// ======================================================
// ELIMINAR USUARIOS
// ======================================================

app.delete(
  '/api/users/:id',
  auth,
  can('users:manage'),
  wrap(async (req, res) => {

    if (String(req.params.id) === String(req.user.id)) {
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

    return res.json({ ok: true });
  })
);

// ======================================================
// RUTAS NO ENCONTRADAS
// ======================================================

app.use((_req, res) => {
  res.status(404).json({
    error: 'Ruta no encontrada'
  });
});

// ======================================================
// MANEJO GLOBAL DE ERRORES
// ======================================================

app.use((error, _req, res, _next) => {
  console.error('[BACKEND ERROR]', error);

  if (res.headersSent) {
    return;
  }

  const status = error.message?.startsWith(
    'Origen no permitido'
  )
    ? 403
    : error.status || error.statusCode || 500;

  res.status(status).json({
    error: status >= 500
      ? 'Error interno del servidor'
      : error.message || 'Error de solicitud'
  });
});

// ======================================================
// INICIALIZAR ALMACENAMIENTO
// ======================================================

async function startServer() {
  try {
    if (config.isProd && store.kind === 'json') {
      console.warn(
        '[AVISO] Producción sin DATABASE_URL. ' +
        'Configura Supabase para conservar los datos.'
      );
    }

    await store.init();

    const created = await seedUsers();

    if (created) {
      console.log('[USUARIOS] Usuarios iniciales creados.');
    }

    // ==================================================
    // INICIAR SERVIDOR
    // ==================================================

    app.listen(config.port, '0.0.0.0', () => {
      console.log('======================================');
      console.log('VISION AI - BACKEND ACTIVO');
      console.log('======================================');

      console.log('Puerto:', config.port);

      console.log(
        'Almacenamiento:',
        store.kind === 'postgres'
          ? 'PostgreSQL (Supabase)'
          : 'Archivo JSON local'
      );

      console.log('YOLO SERVICE:', YOLO_SERVICE_URL);

      console.log(
        'Endpoints YOLO:',
        '/detect, /segment, /quality'
      );

      console.log(
        'Timeout YOLO:',
        YOLO_TIMEOUT_MS + ' ms'
      );

      console.log(
        'CORS permitidos:',
        config.corsOrigins
      );

      console.log('Backend listo para recibir solicitudes');
      console.log('======================================');
    });

  } catch (error) {
    console.error(
      '[STARTUP ERROR] No se pudo iniciar VISION AI:',
      error
    );

    process.exit(1);
  }
}

await startServer();

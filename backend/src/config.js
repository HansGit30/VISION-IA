import 'dotenv/config';

const isProd = process.env.NODE_ENV === 'production';

export const config = {
  isProd,
  port: Number(process.env.PORT || 4000),
  databaseUrl: process.env.DATABASE_URL || '',
  jwtSecret: process.env.JWT_SECRET || (isProd ? '' : 'dev-secret-solo-para-local-cambiar'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  // Lista separada por comas. Ej: https://vision-ai.vercel.app,http://localhost:5173
  corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',').map(s => s.trim()).filter(Boolean),
  // Usuarios iniciales: se crean solo si la tabla de usuarios está vacía.
  seedUsers: [
    { role: 'admin',      name: 'Administrador', email: process.env.SEED_ADMIN_EMAIL      || 'admin@visionai.pe',      password: process.env.SEED_ADMIN_PASSWORD      || 'Admin#2026' },
    { role: 'supervisor', name: 'Supervisor',    email: process.env.SEED_SUPERVISOR_EMAIL || 'supervisor@visionai.pe', password: process.env.SEED_SUPERVISOR_PASSWORD || 'Supervisor#2026' },
    { role: 'operador',   name: 'Hans Operador', email: process.env.SEED_OPERADOR_EMAIL   || 'operador@visionai.pe',   password: process.env.SEED_OPERADOR_PASSWORD   || 'Operador#2026' },
    { role: 'auditor',    name: 'Auditor',       email: process.env.SEED_AUDITOR_EMAIL    || 'auditor@visionai.pe',    password: process.env.SEED_AUDITOR_PASSWORD    || 'Auditor#2026' },
  ],
};

if (!config.jwtSecret) {
  console.error('ERROR: falta la variable JWT_SECRET en producción.');
  process.exit(1);
}

import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { store } from './store.js';

// Crea los usuarios iniciales si la tabla está vacía.
export async function seedUsers({ force = false } = {}) {
  const count = await store.users.count();
  if (count > 0 && !force) return false;
  for (const u of config.seedUsers) {
    if (await store.users.findByEmail(u.email)) continue;
    await store.users.create({ email: u.email, name: u.name, role: u.role, passwordHash: await bcrypt.hash(u.password, 10) });
    console.log(`  usuario creado: ${u.email} (${u.role})`);
  }
  return true;
}

// Uso directo: npm run seed  → crea los usuarios que falten aunque ya existan otros
if (import.meta.url === `file://${process.argv[1]}`) {
  await store.init();
  await seedUsers({ force: true });
  console.log('Seed terminado.');
  process.exit(0);
}

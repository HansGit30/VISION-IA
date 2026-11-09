## VISION AI 2.0: YOLO + Supabase

**Empieza por [GUIA_LOCAL_SUPABASE_YOLO.md](GUIA_LOCAL_SUPABASE_YOLO.md).** Esta versión incorpora un servicio YOLO en Python para imágenes y mantiene los escenarios Three.js como simulación. No hay detección YOLO en video/cámara ni entrenamiento industrial incluido.

# VISION AI · Consola de análisis visual

Escena 3D de seguridad industrial (HANS, cascos, zonas, automóvil), detección real de imágenes con COCO-SSD en el navegador, historial de eventos, alertas, exportación CSV **y ahora login con roles y base de datos compartida**.

```
vision-ai/
├── frontend/          React + Vite + Three.js  → Vercel
├── backend/           API Express + JWT        → Render
├── supabase/          schema.sql (PostgreSQL)  → Supabase
├── docs/GUIA_DESPLIEGUE.md   paso a paso para publicar en internet
├── render.yaml        Blueprint de Render
└── CREDENCIALES.md    usuarios locales y de producción (no se sube a git)
```

## Correr en tu PC

Requisito: Node.js 18+ (recomendado 22).

```bash
npm run setup     # instala dependencias de raíz, backend y frontend
npm run dev       # API en http://localhost:4000 + web en http://localhost:5173
```

Abre **http://localhost:5173** y entra con:

| Rol | Correo | Contraseña |
|---|---|---|
| Administrador | admin@visionai.pe | `Admin#2026` |
| Supervisor | supervisor@visionai.pe | `Supervisor#2026` |
| Operador | operador@visionai.pe | `Operador#2026` |
| Auditor | auditor@visionai.pe | `Auditor#2026` |

Sin configurar nada, los datos se guardan en `backend/data/db.json`. Para usar Supabase también en local, copia `backend/.env.example` a `backend/.env` y rellena `DATABASE_URL`.

Otros comandos: `npm run build` (compila el frontend), `npm start` (solo API), `npm run seed` (crea usuarios faltantes).

## Escenarios

Seis entornos detallados: planta industrial (seguridad), línea de manufactura, almacén/retail, patio de transporte, campo agrícola y laboratorio.

- **Automático**: HANS recorre la escena solo.
- **Manual**: muévelo con **W A S D** o las **flechas** (Shift = correr) o con el mando táctil en el móvil. Choca con estanterías, camiones, máquinas, etc.
- **Vista 3D** (orbital, con opción *Cámara sigue a HANS*) o **Vista 2D · planta** (desde arriba).
- Las detecciones y alertas se generan igual en ambos modos al acercarse a los objetos.

## Roles

| Permiso | Admin | Supervisor | Operador | Auditor |
|---|:-:|:-:|:-:|:-:|
| Ver dashboard, historial, exportar CSV | ✓ | ✓ | ✓ | ✓ |
| Registrar eventos 3D y análisis de imágenes | ✓ | ✓ | ✓ | |
| Marcar alertas como revisadas | ✓ | ✓ | | |
| Gestionar usuarios y borrar historial | ✓ | | | |

## API

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/health` | Estado y tipo de almacenamiento |
| POST | `/api/auth/login` | `{email,password}` → `{token,user}` |
| GET | `/api/auth/me` | Usuario de la sesión |
| POST | `/api/auth/change-password` | Cambiar mi contraseña |
| GET/POST | `/api/events` | Listar / registrar eventos 3D |
| PATCH | `/api/events/:id` | Marcar revisada |
| GET/POST | `/api/analyses` | Listar / registrar análisis de imágenes |
| DELETE | `/api/data` | Borrar historial (admin) |
| GET/POST/PATCH/DELETE | `/api/users` | Gestión de usuarios (admin) |

Contraseñas con bcrypt, sesiones JWT (8 h), límite de 10 intentos fallidos de login cada 15 min, CORS restringido.

## Publicar en internet

Sigue **[docs/GUIA_DESPLIEGUE.md](docs/GUIA_DESPLIEGUE.md)**: GitHub → Supabase → Render → Vercel.

## Limitaciones honestas

- La escena 3D usa detección **DEMO** por proximidad geométrica, no YOLO.
- COCO-SSD solo reconoce sus 80 clases genéricas (persona, auto, etc.): no cascos, chalecos ni defectos.
- La segmentación real no está implementada.

# Guía de despliegue · VISION AI

Cómo pasar de tu PC a internet con tres servicios gratuitos:

```
 Navegador ──► Vercel (frontend React/Vite) ──► Render (API Express + login JWT) ──► Supabase (PostgreSQL)
```

| Pieza | Carpeta | Servicio | Qué hace |
|---|---|---|---|
| Frontend | `frontend/` | **Vercel** | Escena 3D, detección COCO-SSD en el navegador, pantallas |
| API | `backend/` | **Render** | Login, roles, guarda eventos, análisis y usuarios |
| Base de datos | `supabase/schema.sql` | **Supabase** | Tablas `app_users`, `events`, `analyses` |

Tiempo estimado: 30–40 minutos la primera vez.

---

## Paso 0 · Probar en tu PC

Requisitos: **Node.js 18 o superior** (recomendado 22) → https://nodejs.org

```bash
cd vision-ai
npm run setup        # instala raíz, backend y frontend
npm run dev          # levanta API (puerto 4000) + web (puerto 5173)
```

Abre http://localhost:5173 e ingresa con `admin@visionai.pe` / `Admin#2026` (ver `CREDENCIALES.md`).
En local no necesitas base de datos: los datos se guardan en `backend/data/db.json`.

Opcional: probar en local contra Supabase → copia `backend/.env.example` a `backend/.env` y rellena `DATABASE_URL` (paso 2).

Comprobación rápida de producción en local:

```bash
npm run build                       # compila el frontend (debe terminar en "✓ built")
curl http://localhost:4000/api/health
```

---

## Paso 1 · Subir el proyecto a GitHub

Vercel y Render despliegan desde un repositorio de GitHub.

1. Crea un repositorio vacío en https://github.com/new (por ejemplo `vision-ai`, puede ser privado).
2. En la carpeta `vision-ai`:

```bash
git init
git add .
git commit -m "VISION AI: frontend + API + Supabase"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/vision-ai.git
git push -u origin main
```

`.gitignore` ya excluye `node_modules`, `.env`, `backend/data/` y `CREDENCIALES.md`.

---

## Paso 2 · Supabase (base de datos)

1. Entra a https://supabase.com → **Start your project** → inicia sesión con GitHub.
2. **New project**
   - Name: `vision-ai`
   - Database Password: crea una **sin caracteres raros** (letras y números, ≥ 16) y anótala en `CREDENCIALES.md`.
   - Region: la más cercana a tus usuarios (para Perú: *South America (São Paulo)* o *East US*). Usa la **misma región** en Render si puedes.
3. Espera ~2 minutos a que se cree.
4. **Crear las tablas** (opcional: la API también las crea sola al arrancar):
   menú izquierdo **SQL Editor** → **New query** → pega el contenido de `supabase/schema.sql` → **Run**. Debe decir *Success. No rows returned*.
5. **Copiar la cadena de conexión**: botón **Connect** (arriba en el panel del proyecto) → pestaña **Connection string** → elige **Session pooler** (funciona por IPv4, que es lo que usa Render). Se ve así:

```
postgresql://postgres.abcdefghijkl:[YOUR-PASSWORD]@aws-0-sa-east-1.pooler.supabase.com:5432/postgres
```

Reemplaza `[YOUR-PASSWORD]` por tu contraseña (sin corchetes). Esta es tu `DATABASE_URL`.

> ⚠️ No uses la opción *Direct connection* (`db.xxxx.supabase.co`): es solo IPv6 y Render no puede conectarse.
> Si tu contraseña tiene `@ # / ? :` debes codificarlos (`@`→`%40`, `#`→`%23`), por eso conviene usar solo letras y números.

Seguridad: el esquema activa RLS sin políticas públicas, así que la *anon key* de Supabase no puede leer las tablas. Solo la API (con la cadena de conexión) accede.

---

## Paso 3 · Render (API)

### Opción A · Blueprint (recomendada, usa `render.yaml`)

1. https://render.com → inicia sesión con GitHub.
2. **New +** → **Blueprint** → conecta tu repositorio `vision-ai`.
3. Render lee `render.yaml` y te pide los valores marcados como secretos:

| Variable | Valor |
|---|---|
| `DATABASE_URL` | La cadena *Session pooler* del paso 2 |
| `CORS_ORIGIN` | Por ahora `https://*.vercel.app` (lo afinamos en el paso 5) |
| `SEED_ADMIN_PASSWORD` | Ver `CREDENCIALES.md` sección 2 |
| `SEED_SUPERVISOR_PASSWORD` | Ver `CREDENCIALES.md` |
| `SEED_OPERADOR_PASSWORD` | Ver `CREDENCIALES.md` |
| `SEED_AUDITOR_PASSWORD` | Ver `CREDENCIALES.md` |

`JWT_SECRET` se genera solo.
4. **Apply** y espera el deploy (3–5 min).

### Opción B · Manual

**New +** → **Web Service** → elige el repo y configura:

- Root Directory: `backend`
- Runtime: Node · Build Command: `npm install` · Start Command: `npm start`
- Instance type: Free
- Health Check Path (Advanced): `/api/health`
- Environment: `NODE_ENV=production`, `JWT_SECRET` (de `CREDENCIALES.md`), `DATABASE_URL`, `CORS_ORIGIN`, y las 4 `SEED_*_PASSWORD`.

### Verificar

En **Logs** deberías ver:

```
  usuario creado: admin@visionai.pe (admin)
  ...
VISION AI API escuchando en http://localhost:10000
Almacenamiento: PostgreSQL (Supabase)
```

Abre `https://TU-API.onrender.com/api/health` → debe responder `{"ok":true,"storage":"postgres",...}`.
Si dice `"storage":"json"` falta `DATABASE_URL` (los datos se perderían en cada reinicio).

En Supabase → **Table Editor** → `app_users` verás los 4 usuarios (con la contraseña cifrada con bcrypt).

Copia la URL pública de Render (ej. `https://vision-ai-api.onrender.com`).

---

## Paso 4 · Vercel (frontend)

1. https://vercel.com → inicia sesión con GitHub → **Add New…** → **Project** → **Import** el repo `vision-ai`.
2. Configuración:
   - **Root Directory**: `frontend` (botón *Edit*) ← importante
   - Framework Preset: **Vite** (lo detecta solo; `vercel.json` ya define build y salida `dist`)
   - **Environment Variables**:
     - `VITE_API_URL` = `https://vision-ai-api.onrender.com` (tu URL de Render, **sin** `/` final)
3. **Deploy** (1–2 min). Copia tu URL, por ejemplo `https://vision-ai.vercel.app`.

> Las variables `VITE_*` se incrustan al compilar. Si cambias `VITE_API_URL`, ve a **Deployments → ⋯ → Redeploy**.

---

## Paso 5 · Cerrar CORS

En Render → tu servicio → **Environment** → edita `CORS_ORIGIN`:

```
https://vision-ai.vercel.app,https://*.vercel.app
```

(la primera es tu dominio de producción; la segunda permite las *preview deployments*. Si no quieres previews, deja solo la primera.)
**Save, rebuild and deploy**.

---

## Paso 6 · Prueba final

1. Abre tu URL de Vercel. La primera vez puede tardar ~50 s: Render gratis "duerme" tras 15 min sin uso.
2. Ingresa con `admin@visionai.pe` y la contraseña de producción.
3. **Nuevo análisis** → la escena 3D genera eventos → en el lateral debe verse **● Sincronizado**.
4. Abre la URL en otra ventana de incógnito con `operador@visionai.pe`: verás el mismo historial (se sincroniza cada 10 s).
5. En Supabase → Table Editor → `events` aparecerán las filas.
6. **Configuración → Mi contraseña**: cambia la contraseña del administrador.

---

## Actualizar la app

Cada `git push` a `main` redepliega solo en Vercel y Render.

```bash
git add . && git commit -m "cambio" && git push
```

## Dominio propio (opcional)

- Vercel → Project → **Settings → Domains** → añade `app.tudominio.com` y crea el CNAME que te indica.
- Añade ese dominio a `CORS_ORIGIN` en Render.

## Solución de problemas

| Síntoma | Causa / solución |
|---|---|
| Login dice *No se pudo conectar con el servidor* | Render está despertando (espera 1 min) o `VITE_API_URL` está mal → corrígelo y **Redeploy** en Vercel. |
| Error *Origen no permitido por CORS* | Agrega tu URL exacta de Vercel a `CORS_ORIGIN` (con `https://`, sin `/` final). |
| Render: `ENOTFOUND` / `ENETUNREACH` con la BD | Usaste *Direct connection*. Cambia a **Session pooler**. |
| Render: `password authentication failed` | Contraseña de Supabase mal escrita o con caracteres sin codificar. Puedes reiniciarla en Supabase → Project Settings → Database. |
| `/api/health` muestra `"storage":"json"` | Falta `DATABASE_URL` en Render. |
| Login *Correo o contraseña incorrectos* en producción | Los usuarios se crearon con otras `SEED_*`. Revisa la tabla `app_users`; o borra sus filas en Supabase y reinicia el servicio (Manual Deploy → *Restart*) para que se vuelvan a crear. |
| La escena 3D aparece en negro | El navegador no tiene WebGL activo (activa aceleración por hardware). |
| *Demasiados intentos* | Protección anti fuerza bruta: 10 intentos fallidos → espera 15 min. |
| Supabase pausó el proyecto | En el plan gratis se pausa tras 7 días sin uso. Entra al panel y pulsa **Restore**. |

## Límites del plan gratuito (referencia)

- **Render Free**: se suspende tras 15 min sin tráfico; primer acceso lento.
- **Supabase Free**: 500 MB de base de datos; pausa por inactividad semanal.
- **Vercel Hobby**: uso personal/no comercial.

Revisa las páginas de precios de cada servicio: las condiciones cambian con el tiempo.

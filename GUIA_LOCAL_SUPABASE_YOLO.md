# VISION AI 2.0 — ejecución local con Supabase y YOLO

## Requisitos
- Windows 10/11, Node.js 22 LTS, Python 3.11 recomendado, Git opcional.
- Internet en la instalación y primera ejecución YOLO para descargar los pesos del modelo.
- Proyecto Supabase activo y contraseña de base de datos.
- Se recomienda 8 GB RAM mínimo; con CPU funciona pero la inferencia será más lenta.

## 1. Supabase
1. Crea un proyecto en https://supabase.com/dashboard.
2. En **Connect** o **Project Settings > Database** copia el URI de conexión **Session pooler** (compatible IPv4); utiliza la contraseña de la base de datos. No compartas esta cadena.
3. Ejecuta el archivo `supabase/schema.sql` en **SQL Editor** si deseas preparar las tablas; el backend también ejecuta el esquema al iniciar con credenciales suficientes.
4. Copia `backend/.env.example` como `backend/.env` y rellena `DATABASE_URL` con la cadena real. Reemplaza `JWT_SECRET` por una cadena aleatoria larga y las contraseñas `SEED_*` por otras seguras ANTES del primer arranque.
5. `DATABASE_URL` vacía habilita JSON local, **no Supabase**. Verifica en `/api/health` que `storage` sea `postgres`.

## 2. Instalar frontend y backend Node
En PowerShell desde la carpeta `vision-ai`:
```powershell
npm run setup
```

## 3. Instalar YOLO en Python
Abre **otra** terminal PowerShell en la carpeta principal:
```powershell
cd yolo-service
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
python -m uvicorn main:app --host 127.0.0.1 --port 8000
```
Si PowerShell bloquea Activate.ps1, usa `.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000` sin activar. Si `py -3.11` no existe, instala Python 3.11 y marca la opción PATH. Si Windows falla por rutas largas, habilita Long Paths y usa una carpeta corta como `C:\vision-ai`.

## 4. Arrancar la aplicación
Abre una **tercera** terminal en la carpeta `vision-ai`:
```powershell
npm run dev
```
Visita http://localhost:5173. El backend está en http://localhost:4000/api/health y YOLO en http://127.0.0.1:8000/health.

## 5. Prueba
1. Inicia sesión con el administrador configurado en `backend/.env`.
2. En **Nuevo análisis**, selecciona un sector, luego **Cargar imagen · REAL**.
3. Selecciona JPG/PNG/WebP hasta 12 MB y pulsa **Analizar imagen**.
4. La primera inferencia descarga `yolo11n.pt`; espera hasta que termine.
5. Las cajas de detección se muestran en pantalla y los resultados se guardan mediante Express en Supabase.
6. En el historial y dashboard puedes consultar los análisis y eventos guardados.

## Qué es real y qué es DEMO
- YOLO general realiza detección real sobre **imágenes** (no video ni webcam en esta versión).
- Los escenarios Three.js siguen siendo **simulaciones 3D**; sus eventos se guardan como eventos DEMO.
- El modelo general COCO no identifica cascos, daños de cajas, pallets y otras clases industriales especializadas sin un modelo entrenado para esas clases.
- Para usar pesos personalizados, ponlos en `yolo-service/weights/best.pt` y define `YOLO_MODEL=weights/best.pt` en el entorno de Python antes de arrancar.
- No hay segmentación real con el modelo de detección `yolo11n.pt`.

## Solución de problemas
- `storage: json`: revisa `DATABASE_URL` y reinicia Node.
- Error de base de datos: revisa URI, contraseña codificada en URL y que el proyecto Supabase esté activo.
- Error 503 YOLO: comprueba http://127.0.0.1:8000/health y la terminal Python.
- Descarga de pesos: permite salida a internet; en redes cerradas descarga los pesos en otro equipo y configúralos localmente.
- `ModuleNotFoundError`: ejecuta `pip install -r requirements.txt` dentro del entorno virtual.
- En el primer inicio, el backend crea usuarios de ejemplo solo cuando la tabla de usuarios está vacía. Cambia las credenciales antes del primer inicio.

## Seguridad
No subas `.env`, contraseñas ni pesos privados a GitHub. El navegador no se conecta directamente a Supabase con privilegios: lo hace Express usando `DATABASE_URL`. El endpoint de YOLO exige autenticación y permiso de escritura en Express. FastAPI escucha solo en 127.0.0.1 en local.

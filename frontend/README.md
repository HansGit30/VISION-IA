# VISION AI — Frontend

> Para instalar todo (frontend + API) usa el README de la carpeta raíz. Este frontend necesita la API de `../backend` para el login.

## Inicio

```bash
npm install
npm run dev
```

## Módulos

Resumen (Dashboard); Análisis visual (Nuevo análisis, Galería de escenarios, Resultados); Visión IA (Detecciones, Segmentación, Patrones); Operaciones (Alertas, Historial, Exportaciones); Administración (Escenarios, Clases, Reglas, Usuarios, Configuración).

## Flujo

1. Selecciona un sector entre los seis disponibles.
2. Elige **Escena 3D DEMO** o **Cargar imagen REAL**.
3. En DEMO, el operador 3D camina y genera eventos por proximidad con notificaciones y alertas revisables.
4. En REAL, carga JPG/PNG/WebP de hasta 12 MB, configura umbral y pulsa Analizar. El navegador descarga COCO-SSD y ejecuta inferencia local.
5. Revisa resultados, alertas, historial, dashboard y exportaciones CSV.

## Limitaciones transparentes

- El 3D usa proximidad simulada, **no YOLO**.
- COCO-SSD no detecta cascos, pallets, cajas industriales, defectos, cultivos especializados ni segmentación. Elegir un sector no reentrena el modelo.
- Los resultados reales solo corresponden a clases compatibles con COCO-SSD. Las alertas 3D son de demostración.
- El módulo de segmentación real no está implementado (requiere un modelo adicional).
- Login con roles (admin, supervisor, operador, auditor) contra la API. El historial se guarda en el servidor (archivo local o Supabase) y se comparte entre usuarios.

## Verificación

`npm run build` compila sin errores (TypeScript + Vite).

## Seguridad industrial: interacción en tiempo real
- El personaje se identifica como HANS.
- El automóvil se mueve mientras la simulación está activa.
- Casco 1 delimita una zona restringida (roja) y casco 2 una zona de acceso (verde).
- Al entrar en las zonas se genera un evento con fecha y hora local del dispositivo, que se guarda en el historial y puede exportarse a CSV.
- La hora en pantalla se actualiza cada segundo. La detección es DEMO geométrica por proximidad, no YOLO real.
- Pausar escena detiene el movimiento de los objetos y las detecciones por proximidad.

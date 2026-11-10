
import os
import io
import time
import base64
import logging
import tempfile
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

import httpx
from fastapi import FastAPI, HTTPException, Request
from PIL import Image, UnidentifiedImageError
from inference_sdk import InferenceHTTPClient, InferenceConfiguration

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("vision-ai")

app = FastAPI(title="VISION AI - Roboflow", version="3.1.0")

API_KEY = os.getenv("ROBOFLOW_API_KEY", "").strip()

GENERAL = os.getenv("ROBOFLOW_GENERAL_MODEL", "").strip()
WORKSPACE = os.getenv("ROBOFLOW_WORKSPACE", "hans-ol").strip()
WORKFLOW_ID = os.getenv("ROBOFLOW_WORKFLOW_ID", "").strip()
SAFETY = os.getenv("ROBOFLOW_SAFETY_MODEL", "").strip()
CONES = os.getenv("ROBOFLOW_CONES_MODEL", "").strip()
QUALITY = os.getenv("ROBOFLOW_QUALITY_MODEL", "").strip()
DEFECTS = os.getenv("ROBOFLOW_DEFECT_MODEL", "").strip()
SEGMENT = os.getenv("ROBOFLOW_SEG_MODEL", "").strip()

MAX_BYTES = 12 * 1024 * 1024
MAX_PIXELS = 30_000_000
TIMEOUT = float(os.getenv("ROBOFLOW_TIMEOUT", "25"))
MAX_WORKERS = 3

# Se utilizan nombres de clase reales del modelo.
# No se inventan detecciones de montacargas a partir de truck.


def validate_image(data):
    if not data:
        raise HTTPException(400, "No se recibió una imagen.")

    if len(data) > MAX_BYTES:
        raise HTTPException(413, "Imagen superior a 12 MB.")

    try:
        with Image.open(io.BytesIO(data)) as img:
            img.verify()

        with Image.open(io.BytesIO(data)) as img:
            width, height = img.size

        if width < 64 or height < 64:
            raise HTTPException(400, "Imagen demasiado pequeña.")

        if width * height > MAX_PIXELS:
            raise HTTPException(413, "Imagen demasiado grande.")

        return width, height

    except HTTPException:
        raise
    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        Image.DecompressionBombError,
    ):
        raise HTTPException(400, "Imagen inválida.")


def normalize_predictions(payload, width, height, source):
    detections = []

    predictions = payload.get("predictions", [])

    if not isinstance(predictions, list):
        return detections

    for pred in predictions:
        try:
            label = str(
                pred.get("class", pred.get("label", "unknown"))
            )
            score = float(pred.get("confidence", 0))

            x = float(pred["x"])
            y = float(pred["y"])
            w = float(pred["width"])
            h = float(pred["height"])

            x1 = x - w / 2
            y1 = y - h / 2

            def clamp(value):
                return round(max(0, min(1, value)), 6)

            detection = {
                "label": label,
                "class_id": int(pred.get("class_id", -1)),
                "score": round(score, 5),
                "bbox": [
                    clamp(x1 / width),
                    clamp(y1 / height),
                    clamp(w / width),
                    clamp(h / height),
                ],
                "source": source,
            }

            points = pred.get("points")

            if isinstance(points, list) and len(points) >= 3:
                polygon = []

                for point in points[:500]:
                    if isinstance(point, dict):
                        px = float(point["x"])
                        py = float(point["y"])
                    else:
                        px = float(point[0])
                        py = float(point[1])

                    polygon.append([
                        clamp(px / width),
                        clamp(py / height),
                    ])

                detection["polygon"] = polygon

            detections.append(detection)

        except (KeyError, TypeError, ValueError) as exc:
            log.warning("Predicción inválida: %s", exc)

    return detections


def run_roboflow(model_id, image_bytes, confidence, source, width, height, task="detect"):
    if not model_id:
        return []

    if not API_KEY:
        raise RuntimeError("Falta ROBOFLOW_API_KEY.")

    # IDs esperados: nombre-modelo/version
    if "/" not in model_id:
        raise RuntimeError(f"ID de modelo inválido: {model_id}")

    host = (
        "https://segment.roboflow.com"
        if task == "segment"
        else "https://detect.roboflow.com"
    )

    url = f"{host}/{model_id}"

    encoded = base64.b64encode(image_bytes).decode("ascii")

    log.info("Consultando Roboflow: %s", model_id)

    with httpx.Client(timeout=TIMEOUT) as client:
        response = client.post(
            url,
            params={
                "api_key": API_KEY,
                "confidence": round(confidence * 100),
            },
            content=encoded,
            headers={
                "Content-Type": "application/x-www-form-urlencoded"
            },
        )

        response.raise_for_status()
        payload = response.json()

    # Roboflow puede procesar una imagen reescalada.
    # Las coordenadas deben normalizarse usando
    # las dimensiones de la respuesta.
    image_info = payload.get("image", {})

    result_width = float(image_info.get("width") or width)
    result_height = float(image_info.get("height") or height)

    return normalize_predictions(
        payload,
        result_width,
        result_height,
        source,
    )



def run_person_workflow(image_bytes, confidence, width, height):
    """Ejecuta el Workflow de personas sin cargar modelos en Render."""
    if not API_KEY or not WORKFLOW_ID:
        raise RuntimeError("Faltan ROBOFLOW_API_KEY o ROBOFLOW_WORKFLOW_ID")

    # El SDK acepta una ruta de imagen local; el archivo se elimina al terminar.
    with Image.open(io.BytesIO(image_bytes)) as img:
        rgb = img.convert("RGB")
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
            image_path = tmp.name
        try:
            rgb.save(image_path, format="JPEG", quality=90)
        finally:
            rgb.close()

    try:
        client = InferenceHTTPClient(
            api_url="https://serverless.roboflow.com",
            api_key=API_KEY,
        ).configure(InferenceConfiguration(api_key_transport="header"))
        raw = client.run_workflow(
            workspace_name=WORKSPACE,
            workflow_id=WORKFLOW_ID,
            images={"image": image_path},
            use_cache=True,
        )
    finally:
        Path(image_path).unlink(missing_ok=True)

    # Workflows suele devolver una lista de outputs, cada uno con un bloque
    # de predicciones: {"predictions": {"image": {...}, "predictions": [...]}}.
    # También se admite la respuesta de detección directa.
    outputs = raw if isinstance(raw, list) else [raw]
    detections = []
    recognized = False

    for output in outputs:
        if not isinstance(output, dict):
            continue
        candidates = [output]
        candidates.extend(v for v in output.values() if isinstance(v, dict))
        for candidate in candidates:
            predictions = candidate.get("predictions")
            if not isinstance(predictions, list):
                continue
            recognized = True
            info = candidate.get("image") or {}
            pw = float(info.get("width") or width) if isinstance(info, dict) else width
            ph = float(info.get("height") or height) if isinstance(info, dict) else height
            normalized = normalize_predictions(candidate, pw, ph, "roboflow-person-workflow")
            for detection in normalized:
                if detection["label"].strip().lower() in ("person", "people", "persona"):
                    if detection["score"] >= confidence:
                        detection["label"] = "person"
                        detections.append(detection)

    if not recognized:
        keys = [list(o.keys()) for o in outputs if isinstance(o, dict)]
        raise RuntimeError(
            f"Workflow sin salida de predicciones reconocible. Claves: {keys}"
        )

    log.info("Workflow %s: %d personas", WORKFLOW_ID, len(detections))
    return detections


def merge_detections(items):
    merged = []

    def iou(a, b):
        ax, ay, aw, ah = a
        bx, by, bw, bh = b

        x1 = max(ax, bx)
        y1 = max(ay, by)
        x2 = min(ax + aw, bx + bw)
        y2 = min(ay + ah, by + bh)

        intersection = max(0, x2 - x1) * max(0, y2 - y1)
        union = aw * ah + bw * bh - intersection

        return intersection / union if union > 0 else 0

    for item in sorted(items, key=lambda x: x["score"], reverse=True):
        duplicate = None

        for current in merged:
            if (
                item["label"].lower() == current["label"].lower()
                and iou(item["bbox"], current["bbox"]) >= 0.70
            ):
                duplicate = current
                break

        if duplicate is None:
            merged.append(item)
        elif "polygon" in item and "polygon" not in duplicate:
            duplicate["polygon"] = item["polygon"]

    return merged


def analyze_external(image_bytes, width, height, confidence, mode):
    started = time.perf_counter()

    if mode == "quality":
        models = [
            ("quality", QUALITY, "detect"),
            ("defects", DEFECTS, "detect"),
        ]
    elif mode == "segment":
        models = [
            ("segmentation", SEGMENT, "segment"),
        ]
    else:
        models = [
            ("general", GENERAL if not WORKFLOW_ID else "", "detect"),
            ("safety", SAFETY, "detect"),
            ("cones", CONES, "detect"),
        ]

    active = [(name, model, task) for name, model, task in models if model]

    if not active and not (mode == "detect" and WORKFLOW_ID):
        raise HTTPException(
            503,
            f"No hay modelos externos configurados para {mode}."
        )

    results = []
    failures = []
    successful_models = []

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {}
        if mode == "detect" and WORKFLOW_ID:
            futures[executor.submit(
                run_person_workflow, image_bytes, confidence, width, height
            )] = ("person-workflow", WORKFLOW_ID)
        futures.update({
            executor.submit(
                run_roboflow,
                model,
                image_bytes,
                confidence,
                name,
                width,
                height,
                task,
            ): (name, model)
            for name, model, task in active
        })

        for future in as_completed(futures):
            name, model = futures[future]

            try:
                detections = future.result()
                results.extend(detections)
                successful_models.append(model)

            except Exception as exc:
                log.exception("Falló modelo %s", model)
                failures.append({
                    "model": model,
                    "error": str(exc)[:200],
                })

    if not successful_models:
        raise HTTPException(
            502,
            detail={
                "message": "Fallaron todas las consultas a Roboflow.",
                "failures": failures,
            },
        )

    detections = merge_detections(results)

    return {
        "ok": True,
        "model": " + ".join(successful_models),
        "models": successful_models,
        "width": width,
        "height": height,
        "duration_ms": round(
            (time.perf_counter() - started) * 1000
        ),
        "detections": detections,
        "segmentation": mode == "segment",
        "masks_count": sum(
            "polygon" in d for d in detections
        ),
        "safety_model_used": SAFETY in successful_models if SAFETY else False,
        "quality_analysis": mode == "quality",
        "partial": bool(failures),
        "failures": failures,
    }


@app.get("/")
def root():
    return {"ok": True, "service": "VISION AI Roboflow"}


@app.get("/health")
def health():
    return {
        "ok": True,
        "engine": "roboflow-hosted-inference",
        "version": app.version,
        "api_key_configured": bool(API_KEY),
        "models": {
            "general": GENERAL if not WORKFLOW_ID else None,
            "person_workflow": WORKFLOW_ID or None,
            "workspace": WORKSPACE,
            "safety": SAFETY or None,
            "cones": CONES or None,
            "quality": QUALITY or None,
            "defects": DEFECTS or None,
            "segmentation": SEGMENT or None,
        },
        "loaded_model_count": 0,
    }


@app.post("/detect")
@app.post("/segment")
@app.post("/quality")
async def analyze(request: Request, confidence: float = 0.25):
    if not 0.01 <= confidence <= 0.99:
        raise HTTPException(400, "Confianza fuera de rango.")

    content_type = request.headers.get(
        "content-type", ""
    ).split(";")[0].strip().lower()

    if content_type not in {
        "image/jpeg",
        "image/png",
        "image/webp",
        "application/octet-stream",
    }:
        raise HTTPException(415, "Tipo de imagen no admitido.")

    image_bytes = await request.body()
    width, height = validate_image(image_bytes)

    mode = request.url.path.lstrip("/")

    from fastapi.concurrency import run_in_threadpool

    return await run_in_threadpool(
        analyze_external,
        image_bytes,
        width,
        height,
        confidence,
        mode,
    )


"""
VISION AI - Servicio de inferencia YOLO
Python 3.13.5 + FastAPI + Ultralytics

Endpoints:
  GET  /health
  POST /detect
  POST /segment
  POST /quality

Modelos:
  YOLO_MODEL: deteccion general
  YOLO_SEG_MODEL: segmentacion general
  YOLO_SAFETY_MODEL: deteccion industrial (helmet, vest)
"""

import io
import asyncio
import base64
import os
import time
import logging
from pathlib import Path
from functools import lru_cache
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from PIL import Image, UnidentifiedImageError, ImageOps
from ultralytics import YOLO
import requests

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("vision-ai-yolo")

app = FastAPI(title="VISION AI - YOLO", version="2.3.0")

MAX_BYTES = 12 * 1024 * 1024
MAX_PIXELS = 30_000_000
MAX_DETECTIONS = 300
DUPLICATE_IOU = 0.70

def resolve_model(value: str) -> str:
    """Resuelve rutas locales sin depender del directorio actual."""
    if not value:
        return ""

    path = Path(value)
    if path.is_absolute():
        return str(path)

    local = BASE_DIR / path
    if local.is_file():
        return str(local)

    # Los nombres oficiales de Ultralytics se pueden descargar
    # automaticamente en el primer uso.
    if "/" not in value and "\\" not in value:
        return value

    return str(local)


MODEL_NAME = resolve_model(
    os.getenv("YOLO_MODEL", "yolo11n.pt")
)

SEG_MODEL_NAME = resolve_model(
    os.getenv("YOLO_SEG_MODEL", "yolo11n-seg.pt")
)

SAFETY_MODEL_NAME = resolve_model(
    os.getenv("YOLO_SAFETY_MODEL", "").strip()
)

# Roboflow: deteccion adicional de conos (no descarga pesos).
ROBOFLOW_API_KEY = os.getenv("ROBOFLOW_API_KEY", "").strip()
ROBOFLOW_MODEL_ID = os.getenv("ROBOFLOW_MODEL_ID", "cone-tlbex/3").strip().strip("/")
ROBOFLOW_API_URL = os.getenv("ROBOFLOW_API_URL", "https://detect.roboflow.com").rstrip("/")
ROBOFLOW_CONFIDENCE = float(os.getenv("ROBOFLOW_CONFIDENCE", "0.40"))

# Modelo de control de calidad (independiente del detector de conos).
ROBOFLOW_QA_MODEL = os.getenv("ROBOFLOW_QA_MODEL", "cardboard-boxes-4h3rr-ryjj2/1").strip().strip("/")
ROBOFLOW_QA_API_URL = os.getenv("ROBOFLOW_QA_API_URL", "https://detect.roboflow.com").rstrip("/")
# Opcional: modelo independiente para defectos de embalaje.
ROBOFLOW_QA_DEFECT_MODEL = os.getenv("ROBOFLOW_QA_DEFECT_MODEL", "").strip().strip("/")
ROBOFLOW_QA_DEFECT_API_URL = os.getenv(
    "ROBOFLOW_QA_DEFECT_API_URL", "https://detect.roboflow.com"
).rstrip("/")
QUALITY_DEFECT_LABELS = {
    "damaged", "damage", "defect", "defective", "broken",
    "torn", "crushed", "deformed", "damaged_box", "damaged box",
    "damaged-box", "tear", "dent", "hole", "ripped"
}



@lru_cache(maxsize=4)
def load_model(model_name: str) -> YOLO:
    logger.info("Cargando modelo: %s", model_name)
    return YOLO(model_name)


def calculate_iou(a: list[float], b: list[float]) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b

    left = max(ax, bx)
    top = max(ay, by)
    right = min(ax + aw, bx + bw)
    bottom = min(ay + ah, by + bh)

    intersection = max(0.0, right - left) * max(0.0, bottom - top)
    union = aw * ah + bw * bh - intersection

    return intersection / union if union > 0 else 0.0


def extract_detections(
    result: Any,
    width: int,
    height: int,
    source: str,
    include_masks: bool = False,
) -> list[dict]:

    detections = []

    if result.boxes is None:
        return detections

    for index, box in enumerate(result.boxes):
        x1, y1, x2, y2 = [
            float(v) for v in box.xyxy[0].tolist()
        ]

        class_id = int(box.cls[0].item())
        label = str(result.names.get(class_id, class_id))

        left = max(0.0, min(1.0, x1 / width))
        top = max(0.0, min(1.0, y1 / height))
        right = max(0.0, min(1.0, x2 / width))
        bottom = max(0.0, min(1.0, y2 / height))

        entry = {
            "label": label,
            "class_id": class_id,
            "score": round(float(box.conf[0].item()), 5),
            "bbox": [
                round(left, 6),
                round(top, 6),
                round(max(0.0, right - left), 6),
                round(max(0.0, bottom - top), 6),
            ],
            "source": source,
        }

        if (
            include_masks
            and result.masks is not None
            and index < len(result.masks.xy)
        ):
            points = result.masks.xy[index]

            if len(points) > 500:
                step = max(1, (len(points) + 499) // 500)
                points = points[::step]

            polygon = [
                [
                    round(max(0.0, min(1.0, float(x) / width)), 6),
                    round(max(0.0, min(1.0, float(y) / height)), 6),
                ]
                for x, y in points
            ]

            if len(polygon) >= 3:
                entry["polygon"] = polygon

        detections.append(entry)

        if len(detections) >= MAX_DETECTIONS:
            break

    return detections


def merge_detections(items: list[dict]) -> list[dict]:
    """Elimina cajas duplicadas de la misma clase."""
    ordered = sorted(
        items,
        key=lambda item: item["score"],
        reverse=True,
    )

    merged = []

    for item in ordered:
        duplicate = None

        for current in merged:
            same_class = (
                item["label"].lower()
                == current["label"].lower()
            )

            if (
                same_class
                and calculate_iou(
                    item["bbox"],
                    current["bbox"],
                ) >= DUPLICATE_IOU
            ):
                duplicate = current
                break

        if duplicate is None:
            merged.append(item)

        elif (
            "polygon" in item
            and "polygon" not in duplicate
        ):
            duplicate["polygon"] = item["polygon"]

    return merged


def run_model(
    model_name: str,
    image: Image.Image,
    confidence: float,
    source: str,
    include_masks: bool = False,
) -> list[dict]:

    model = load_model(model_name)

    result = model.predict(
        source=image,
        conf=confidence,
        max_det=MAX_DETECTIONS,
        verbose=False,
    )[0]

    return extract_detections(
        result,
        image.width,
        image.height,
        source,
        include_masks,
    )


def read_image(data: bytes) -> Image.Image:
    if not data:
        raise HTTPException(
            status_code=400,
            detail="No se recibio ninguna imagen.",
        )

    if len(data) > MAX_BYTES:
        raise HTTPException(
            status_code=413,
            detail="La imagen supera 12 MB.",
        )

    try:
        with Image.open(io.BytesIO(data)) as probe:
            if probe.format not in {"JPEG", "PNG", "WEBP"}:
                raise HTTPException(
                    status_code=415,
                    detail="Solo se permiten JPEG, PNG o WebP.",
                )

            width, height = probe.size

            if width < 64 or height < 64:
                raise HTTPException(
                    status_code=400,
                    detail="Minimo 64 x 64 pixeles.",
                )

            if width * height > MAX_PIXELS:
                raise HTTPException(
                    status_code=413,
                    detail="Demasiados pixeles.",
                )

            probe.verify()

        with Image.open(io.BytesIO(data)) as opened:
            image = ImageOps.exif_transpose(opened).convert("RGB")

        return image

    except HTTPException:
        raise
    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        Image.DecompressionBombError,
    ) as exc:
        raise HTTPException(
            status_code=400,
            detail="Archivo de imagen invalido.",
        ) from exc


def detect_cones_roboflow(image: Image.Image, confidence: float) -> list[dict]:
    """Consulta la API alojada de Roboflow y normaliza las cajas a [x,y,w,h]."""
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=90)
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    threshold = max(confidence, ROBOFLOW_CONFIDENCE)
    response = requests.post(
        f"{ROBOFLOW_API_URL}/{ROBOFLOW_MODEL_ID}",
        params={"api_key": ROBOFLOW_API_KEY, "confidence": round(threshold * 100)},
        data=encoded,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=30,
    )
    response.raise_for_status()
    payload = response.json()
    predictions = payload.get("predictions", [])
    if not isinstance(predictions, list):
        raise ValueError("Roboflow devolvio predictions con formato invalido")

    items = []
    for pred in predictions:
        label = str(pred.get("class", "")).lower().replace(" ", "_").replace("-", "_")
        score = float(pred.get("confidence", 0))
        if label not in {"traffic_cone", "cone", "safety_cone"} or score < threshold:
            continue
        x, y = float(pred["x"]), float(pred["y"])
        w, h = float(pred["width"]), float(pred["height"])
        left = max(0.0, min(1.0, (x - w / 2) / image.width))
        top = max(0.0, min(1.0, (y - h / 2) / image.height))
        right = max(0.0, min(1.0, (x + w / 2) / image.width))
        bottom = max(0.0, min(1.0, (y + h / 2) / image.height))
        items.append({
            "label": "cone",
            "class_id": int(pred.get("class_id", 0)),
            "score": round(score, 5),
            "bbox": [round(left, 6), round(top, 6), round(right-left, 6), round(bottom-top, 6)],
            "source": "roboflow-cones",
        })
    return items


@app.get("/health")
def health():
    safety_exists = bool(
        SAFETY_MODEL_NAME
        and Path(SAFETY_MODEL_NAME).is_file()
    )

    return {
        "ok": True,
        "engine": "ultralytics-yolo",
        "version": app.version,
        "models": {
            "general": MODEL_NAME,
            "segmentation": SEG_MODEL_NAME,
            "safety": SAFETY_MODEL_NAME or None,
        },
        "loaded_model_count": load_model.cache_info().currsize,
        "safety_model_configured": bool(SAFETY_MODEL_NAME),
        "safety_model_exists": safety_exists,
        "roboflow_cones_configured": bool(ROBOFLOW_API_KEY),
        "roboflow_quality_configured": bool(ROBOFLOW_API_KEY and ROBOFLOW_QA_MODEL),
        "roboflow_quality_model": ROBOFLOW_QA_MODEL,
        "roboflow_defect_model_configured": bool(ROBOFLOW_QA_DEFECT_MODEL),
    }


@app.post("/detect")
@app.post("/segment")
async def analyze(
    request: Request,
    confidence: float = 0.25,
):
    if not 0.01 <= confidence <= 0.99:
        raise HTTPException(
            status_code=400,
            detail="Confianza fuera de rango.",
        )

    content_type = (
        request.headers.get("content-type", "")
        .split(";")[0]
        .strip()
        .lower()
    )

    accepted = {
        "image/jpeg",
        "image/png",
        "image/webp",
        "application/octet-stream",
    }

    if content_type not in accepted:
        raise HTTPException(
            status_code=415,
            detail="Se requiere imagen JPEG, PNG o WebP.",
        )

    image = read_image(await request.body())
    is_segment = request.url.path.endswith("/segment")
    started = time.perf_counter()

    try:
        detections = []
        used_models = []

        if is_segment:
            detections.extend(
                run_model(
                    SEG_MODEL_NAME,
                    image,
                    confidence,
                    "yolo-seg",
                    include_masks=True,
                )
            )
            used_models.append(SEG_MODEL_NAME)

        else:
            detections.extend(
                run_model(
                    MODEL_NAME,
                    image,
                    confidence,
                    "yolo-general",
                )
            )
            used_models.append(MODEL_NAME)

        if SAFETY_MODEL_NAME:
            detections.extend(
                run_model(
                    SAFETY_MODEL_NAME,
                    image,
                    confidence,
                    "yolo-safety",
                    include_masks=False,
                )
            )
            used_models.append(SAFETY_MODEL_NAME)

        # No interrumpir YOLO si la API externa falla; informar el error al cliente.
        roboflow_status = "not_configured" if not ROBOFLOW_API_KEY else "skipped"
        roboflow_error = None
        if not is_segment and ROBOFLOW_API_KEY:
            try:
                cone_detections = await asyncio.to_thread(
                    detect_cones_roboflow, image, confidence
                )
                detections.extend(cone_detections)
                used_models.append(f"roboflow:{ROBOFLOW_MODEL_ID}")
                roboflow_status = "ok"
                logger.info("Roboflow: %d conos detectados", len(cone_detections))
            except Exception as exc:
                roboflow_status = "error"
                roboflow_error = str(exc)[:200]
                logger.warning("Roboflow no disponible: %s", roboflow_error)

        detections = merge_detections(detections)

        elapsed_ms = round(
            (time.perf_counter() - started) * 1000
        )

        logger.info(
            "Analisis %s: %s detecciones en %s ms",
            "segment" if is_segment else "detect",
            len(detections),
            elapsed_ms,
        )

        return {
            "ok": True,
            "model": " + ".join(
                Path(name).name for name in used_models
            ),
            "models": used_models,
            "width": image.width,
            "height": image.height,
            "duration_ms": elapsed_ms,
            "detections": detections,
            "segmentation": is_segment,
            "masks_count": sum(
                1 for item in detections
                if "polygon" in item
            ),
            "safety_model_used": bool(SAFETY_MODEL_NAME),
            "roboflow_status": roboflow_status,
            "roboflow_error": roboflow_error,
        }

    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Error durante la inferencia")
        raise HTTPException(
            status_code=503,
            detail=f"No se pudo ejecutar YOLO: {str(exc)[:300]}",
        ) from exc


def detect_quality_roboflow(
    image: Image.Image, confidence: float, model_id: str | None = None,
    api_url: str | None = None,
) -> list[dict]:
    """Consulta Roboflow y devuelve detecciones compatibles con el frontend."""
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=90)
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    response = requests.post(
        f"{api_url or ROBOFLOW_QA_API_URL}/{model_id or ROBOFLOW_QA_MODEL}",
        params={"api_key": ROBOFLOW_API_KEY, "confidence": round(confidence * 100)},
        data=encoded,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=35,
    )
    response.raise_for_status()
    payload = response.json()
    predictions = payload.get("predictions", [])
    if not isinstance(predictions, list):
        raise ValueError("Respuesta de Roboflow sin lista de predicciones")

    detections = []
    for pred in predictions[:MAX_DETECTIONS]:
        x, y = float(pred["x"]), float(pred["y"])
        w, h = float(pred["width"]), float(pred["height"])
        left = max(0.0, min(1.0, (x - w / 2) / image.width))
        top = max(0.0, min(1.0, (y - h / 2) / image.height))
        right = max(0.0, min(1.0, (x + w / 2) / image.width))
        bottom = max(0.0, min(1.0, (y + h / 2) / image.height))
        if right <= left or bottom <= top:
            continue
        detections.append({
            "label": str(pred.get("class", "unknown")),
            "class_id": int(pred.get("class_id", 0)),
            "score": round(float(pred.get("confidence", 0)), 5),
            "bbox": [round(left, 6), round(top, 6), round(right-left, 6), round(bottom-top, 6)],
            "source": f"roboflow:{model_id or ROBOFLOW_QA_MODEL}",
        })
    return detections


@app.post("/quality")
async def quality(request: Request, confidence: float = 0.25):
    """Analiza cajas de una imagen; no modifica /detect ni /segment."""
    if not 0.01 <= confidence <= 0.99:
        raise HTTPException(400, "Confianza fuera de rango")
    if not ROBOFLOW_API_KEY:
        raise HTTPException(503, "Configura ROBOFLOW_API_KEY en .env")
    content_type = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if content_type not in {"image/jpeg", "image/png", "image/webp", "application/octet-stream"}:
        raise HTTPException(415, "Se requiere imagen JPEG, PNG o WebP")
    image = read_image(await request.body())
    started = time.perf_counter()
    try:
        detections = await asyncio.to_thread(detect_quality_roboflow, image, confidence)
        defects = []
        if ROBOFLOW_QA_DEFECT_MODEL:
            defects = await asyncio.to_thread(
                detect_quality_roboflow, image, confidence,
                ROBOFLOW_QA_DEFECT_MODEL, ROBOFLOW_QA_DEFECT_API_URL
            )
    except requests.HTTPError as exc:
        logger.warning("Roboflow quality HTTP error: %s", exc)
        raise HTTPException(502, "La API de calidad rechazó la solicitud. Revisa el modelo, la clave y los permisos.") from exc
    except (requests.RequestException, ValueError, KeyError, TypeError) as exc:
        logger.warning("Roboflow quality error: %s", exc)
        raise HTTPException(502, "No se pudo consultar la API de calidad") from exc
    # Combinar ambas fuentes sin contar dos veces una misma caja.
    # Las etiquetas de Roboflow son: normalbox, damagedpackage y damagedpart.
    def norm(label: str) -> str:
        return label.lower().strip().replace(" ", "").replace("_", "").replace("-", "")

    def overlap_small(a: list[float], b: list[float]) -> float:
        ax, ay, aw, ah = a
        bx, by, bw, bh = b
        inter = max(0., min(ax+aw, bx+bw)-max(ax, bx)) * max(0., min(ay+ah, by+bh)-max(ay, by))
        smaller = min(aw*ah, bw*bh)
        return inter/smaller if smaller > 0 else 0.

    def is_box(d: dict) -> bool:
        return norm(d["label"]) in {
            "box", "cardboardbox", "carton", "package", "normalbox", "damagedpackage"
        }

    def is_damage(d: dict) -> bool:
        label = norm(d["label"])
        return label in {"damagedpackage", "damagedpart"} or any(
            norm(term) in label for term in QUALITY_DEFECT_LABELS
        )

    box_predictions = sorted(
        [d for d in detections + defects if is_box(d)],
        key=lambda d: (
            1 if norm(d["label"]) in {"normalbox", "damagedpackage"} else 0,
            d["score"]
        ), reverse=True
    )
    boxes = []
    for candidate in box_predictions:
        match = next((b for b in boxes if calculate_iou(b["bbox"], candidate["bbox"]) >= 0.45), None)
        if match is None:
            boxes.append(dict(candidate))
        elif norm(candidate["label"]) == "damagedpackage":
            # Una alerta explícita de daño tiene prioridad frente a normalbox.
            match["label"] = candidate["label"]
            match["score"] = candidate["score"]
            match["source"] = candidate["source"]

    damage_predictions = [d for d in defects if is_damage(d)]
    for box in boxes:
        linked = [d for d in damage_predictions if overlap_small(box["bbox"], d["bbox"]) >= 0.35]
        direct_damage = norm(box["label"]) == "damagedpackage"
        box["quality_status"] = (
            "posible_defecto" if direct_damage or linked else "sin_defecto_detectado"
        )
        box["defects"] = sorted(set(
            ([box["label"]] if direct_damage else []) + [d["label"] for d in linked]
        ))

    # Las partes dañadas se muestran por separado, pero no aumentan el total de cajas.
    parts = [d for d in defects if norm(d["label"]) == "damagedpart"]
    extra_defects = [d for d in defects if is_damage(d) and not is_box(d) and d not in parts]
    all_detections = boxes + parts + extra_defects
    models = [f"roboflow:{ROBOFLOW_QA_MODEL}"]
    if ROBOFLOW_QA_DEFECT_MODEL:
        models.append(f"roboflow:{ROBOFLOW_QA_DEFECT_MODEL}")
    return {
        "ok": True,
        "model": " + ".join(models),
        "models": models,
        "width": image.width,
        "height": image.height,
        "duration_ms": round((time.perf_counter() - started) * 1000),
        "detections": all_detections,
        "total": len(boxes),
        "damaged": sum(b["quality_status"] == "posible_defecto" for b in boxes),
        "quality_model_configured": bool(ROBOFLOW_QA_DEFECT_MODEL),
        "segmentation": False,
        "masks_count": 0,
    }

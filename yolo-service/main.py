
"""
VISION AI - Servicio de inferencia YOLO
Versión optimizada para Render.

Endpoints:
GET  /health
POST /detect
POST /segment
POST /quality

Mantiene el formato de detecciones:
label, class_id, score, bbox, source y polygon.
"""

import gc
import io
import logging
import os
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from PIL import Image, UnidentifiedImageError
from ultralytics import YOLO

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("vision-ai-yolo")

app = FastAPI(
    title="VISION AI - YOLO",
    version="2.2.0"
)

MODEL_NAME = os.getenv(
    "YOLO_MODEL", "yolo11n.pt"
).strip()

SEG_MODEL_NAME = os.getenv(
    "YOLO_SEG_MODEL", "yolo11n-seg.pt"
).strip()

SAFETY_MODEL_NAME = os.getenv(
    "YOLO_SAFETY_MODEL", ""
).strip()

MAX_BYTES = 12 * 1024 * 1024
MAX_PIXELS = 30_000_000
MAX_DETECTIONS = 150
IOU_THRESHOLD = 0.70

# Reducir consumo de memoria en CPU.
INFERENCE_SIZE = int(os.getenv("YOLO_IMGSZ", "512"))

# Evitar inferencias simultáneas dentro del proceso.
inference_lock = threading.Lock()


def safety_model_exists() -> bool:
    if not SAFETY_MODEL_NAME:
        return False

    return Path(SAFETY_MODEL_NAME).is_file()


def _iou(a: list, b: list) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b

    x1 = max(ax, bx)
    y1 = max(ay, by)

    x2 = min(ax + aw, bx + bw)
    y2 = min(ay + ah, by + bh)

    intersection = (
        max(0, x2 - x1) *
        max(0, y2 - y1)
    )

    union = aw * ah + bw * bh - intersection

    return intersection / union if union > 0 else 0.0


def _merge_detections(items: list) -> list:
    items = sorted(
        items,
        key=lambda item: item["score"],
        reverse=True
    )

    merged = []

    for item in items:
        duplicate = None

        for current in merged:
            if (
                item["label"].lower()
                == current["label"].lower()
                and _iou(
                    item["bbox"],
                    current["bbox"]
                ) >= IOU_THRESHOLD
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


def _load_image(data: bytes) -> Image.Image:
    if not data:
        raise HTTPException(
            status_code=400,
            detail="No se recibió ninguna imagen."
        )

    if len(data) > MAX_BYTES:
        raise HTTPException(
            status_code=413,
            detail="La imagen supera los 12 MB."
        )

    try:
        with Image.open(io.BytesIO(data)) as original:
            original.verify()

        with Image.open(io.BytesIO(data)) as original:
            width, height = original.size

            if width < 64 or height < 64:
                raise HTTPException(
                    status_code=400,
                    detail="Imagen demasiado pequeña."
                )

            if width * height > MAX_PIXELS:
                raise HTTPException(
                    status_code=413,
                    detail="La imagen supera el límite de píxeles."
                )

            image = original.convert("RGB")

    except HTTPException:
        raise
    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        Image.DecompressionBombError
    ) as exc:
        raise HTTPException(
            status_code=400,
            detail="Imagen JPEG, PNG o WebP inválida."
        ) from exc

    return image


def _extract_result(
    result: Any,
    width: int,
    height: int,
    source: str,
    include_masks: bool
) -> list:

    detections = []

    if result.boxes is None:
        return detections

    for index, box in enumerate(result.boxes):
        x1, y1, x2, y2 = [
            float(value)
            for value in box.xyxy[0].tolist()
        ]

        class_id = int(box.cls[0].item())

        label = str(
            result.names.get(class_id, class_id)
        )

        detection = {
            "label": label,
            "class_id": class_id,
            "score": round(
                float(box.conf[0].item()), 5
            ),
            "bbox": [
                round(max(0, min(1, x1 / width)), 6),
                round(max(0, min(1, y1 / height)), 6),
                round(
                    max(0, min(1, (x2 - x1) / width)),
                    6
                ),
                round(
                    max(0, min(1, (y2 - y1) / height)),
                    6
                ),
            ],
            "source": source
        }

        if (
            include_masks
            and result.masks is not None
            and index < len(result.masks.xy)
        ):
            points = result.masks.xy[index]

            if len(points) > 500:
                step = max(1, len(points) // 500)
                points = points[::step]

            polygon = [
                [
                    round(
                        max(0, min(1, float(x) / width)),
                        6
                    ),
                    round(
                        max(0, min(1, float(y) / height)),
                        6
                    )
                ]
                for x, y in points
            ]

            if len(polygon) >= 3:
                detection["polygon"] = polygon

        detections.append(detection)

        if len(detections) >= MAX_DETECTIONS:
            break

    return detections


def _run_model(
    model_name: str,
    image: Image.Image,
    confidence: float,
    source: str,
    include_masks: bool
) -> list:

    model = None
    result = None

    try:
        logger.info(
            "Cargando modelo: %s",
            model_name
        )

        model = YOLO(model_name)

        logger.info(
            "Ejecutando inferencia: %s",
            model_name
        )

        result = model.predict(
            source=image,
            conf=confidence,
            imgsz=INFERENCE_SIZE,
            device="cpu",
            max_det=MAX_DETECTIONS,
            verbose=False
        )[0]

        detections = _extract_result(
            result,
            image.width,
            image.height,
            source,
            include_masks
        )

        logger.info(
            "Modelo %s: %d detecciones",
            model_name,
            len(detections)
        )

        return detections

    finally:
        # No conservar varios modelos en memoria.
        del result
        del model
        gc.collect()


def _analyze_sync(
    image: Image.Image,
    confidence: float,
    is_segment: bool
) -> dict:

    started = time.perf_counter()

    with inference_lock:
        results = []
        used_models = []

        primary_model = (
            SEG_MODEL_NAME
            if is_segment
            else MODEL_NAME
        )

        results.extend(
            _run_model(
                primary_model,
                image,
                confidence,
                source=(
                    "yolo-seg"
                    if is_segment
                    else "yolo-general"
                ),
                include_masks=is_segment
            )
        )

        used_models.append(primary_model)

        if SAFETY_MODEL_NAME:
            if safety_model_exists():
                results.extend(
                    _run_model(
                        SAFETY_MODEL_NAME,
                        image,
                        confidence,
                        source="yolo-safety",
                        include_masks=False
                    )
                )

                used_models.append(
                    SAFETY_MODEL_NAME
                )
            else:
                logger.warning(
                    "Modelo industrial no encontrado: %s",
                    SAFETY_MODEL_NAME
                )

        detections = _merge_detections(results)

    elapsed_ms = round(
        (time.perf_counter() - started) * 1000
    )

    return {
        "ok": True,
        "model": " + ".join(used_models),
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
        "safety_model_used": (
            SAFETY_MODEL_NAME in used_models
        )
    }


@app.get("/")
def root():
    return {
        "ok": True,
        "service": "VISION AI YOLO",
        "health": "/health"
    }


@app.get("/health")
def health():
    return {
        "ok": True,
        "engine": "ultralytics-yolo",
        "version": app.version,
        "models": {
            "general": MODEL_NAME,
            "segmentation": SEG_MODEL_NAME,
            "safety": SAFETY_MODEL_NAME or None
        },
        "safety_model_configured": bool(
            SAFETY_MODEL_NAME
        ),
        "safety_model_exists": safety_model_exists(),
        "loaded_model_count": 0,
        "inference_size": INFERENCE_SIZE,
        "note": (
            "Los modelos se cargan por solicitud "
            "y se liberan después de la inferencia."
        )
    }


@app.post("/detect")
@app.post("/segment")
async def analyze(
    request: Request,
    confidence: float = 0.25
):
    if not 0.01 <= confidence <= 0.99:
        raise HTTPException(
            status_code=400,
            detail="Confianza fuera de rango."
        )

    content_type = (
        request.headers
        .get("content-type", "")
        .split(";")[0]
        .strip()
        .lower()
    )

    accepted_types = {
        "image/jpeg",
        "image/png",
        "image/webp",
        "application/octet-stream"
    }

    if content_type not in accepted_types:
        raise HTTPException(
            status_code=415,
            detail="Formato de contenido no admitido."
        )

    image = _load_image(
        await request.body()
    )

    is_segment = (
        request.url.path == "/segment"
    )

    logger.info(
        "Inicio %s | imagen=%dx%d | confianza=%.2f",
        request.url.path,
        image.width,
        image.height,
        confidence
    )

    try:
        # Evita bloquear el event loop de FastAPI.
        response = await run_in_threadpool(
            _analyze_sync,
            image,
            confidence,
            is_segment
        )

        logger.info(
            "Análisis completado: %s | %d ms",
            request.url.path,
            response["duration_ms"]
        )

        return response

    except HTTPException:
        raise

    except Exception as exc:
        logger.exception(
            "Error ejecutando YOLO en %s",
            request.url.path
        )

        raise HTTPException(
            status_code=503,
            detail=(
                "No se pudo ejecutar YOLO: "
                + str(exc)[:300]
            )
        ) from exc

    finally:
        image.close()


@app.post("/quality")
async def quality():
    # El archivo original compartido no contiene
    # la integración de Roboflow para calidad.
    # No inventar resultados ni sustituirlos
    # por detecciones del modelo general.
    raise HTTPException(
        status_code=503,
        detail=(
            "El módulo de calidad requiere integrar "
            "el código existente de Roboflow QA."
        )
    )

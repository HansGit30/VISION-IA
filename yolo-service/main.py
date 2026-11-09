"""
VISION AI - Servicio de inferencia YOLO
---------------------------------------
Rutas compatibles con el backend Express:
  GET  /health
  POST /detect
  POST /segment

Modelos:
  YOLO_MODEL       Modelo general de detección (por defecto yolo11n.pt)
  YOLO_SEG_MODEL   Modelo general de segmentación (por defecto yolo11n-seg.pt)
  YOLO_SAFETY_MODEL Modelo opcional entrenado para seguridad industrial.

IMPORTANTE:
YOLO_SAFETY_MODEL debe apuntar a pesos reales (.pt) entrenados para las clases
que se necesitan (por ejemplo: helmet, vest, cone, forklift). Este servicio no
inventa clases ni convierte un modelo general en uno especializado.
"""

import io
import os
import time
from functools import lru_cache
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from PIL import Image, UnidentifiedImageError
from ultralytics import YOLO

app = FastAPI(title="VISION AI - YOLO", version="2.1.0")

MODEL_NAME = os.getenv("YOLO_MODEL", "yolo11n.pt")
SEG_MODEL_NAME = os.getenv("YOLO_SEG_MODEL", "yolo11n-seg.pt")
SAFETY_MODEL_NAME = os.getenv("YOLO_SAFETY_MODEL", "").strip()

MAX_BYTES = 12 * 1024 * 1024
MAX_PIXELS = 30_000_000
MAX_DETECTIONS_PER_MODEL = 300
DUPLICATE_IOU_THRESHOLD = 0.70


@lru_cache(maxsize=4)
def load_model(model_name: str) -> YOLO:
    """Carga cada modelo una sola vez por proceso."""
    return YOLO(model_name)


def model_is_loaded(model_name: str) -> bool:
    return any(
        args and args[0] == model_name
        for args, _result in load_model.cache_info().__dict__.items()
    ) if False else load_model.cache_info().currsize > 0


def loaded_model_names() -> list[str]:
    # lru_cache no expone sus claves; esta lista se mantiene como información
    # aproximada mediante los nombres configurados y el número de modelos.
    names = [MODEL_NAME, SEG_MODEL_NAME]
    if SAFETY_MODEL_NAME:
        names.append(SAFETY_MODEL_NAME)
    return names[: load_model.cache_info().currsize]


def _iou(a: list[float], b: list[float]) -> float:
    ax1, ay1, aw, ah = a
    bx1, by1, bw, bh = b
    ax2, ay2 = ax1 + aw, ay1 + ah
    bx2, by2 = bx1 + bw, by1 + bh

    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    intersection = iw * ih
    union = aw * ah + bw * bh - intersection
    return intersection / union if union > 0 else 0.0


def _extract_result(result: Any, image_width: int, image_height: int,
                    source: str, include_masks: bool) -> list[dict]:
    detections: list[dict] = []
    if result.boxes is None:
        return detections

    for index, box in enumerate(result.boxes):
        x1, y1, x2, y2 = [float(v) for v in box.xyxy[0].tolist()]
        class_id = int(box.cls[0].item())
        label = str(result.names.get(class_id, class_id))

        entry = {
            "label": label,
            "class_id": class_id,
            "score": round(float(box.conf[0].item()), 5),
            "bbox": [
                round(max(0.0, min(1.0, x1 / image_width)), 6),
                round(max(0.0, min(1.0, y1 / image_height)), 6),
                round(max(0.0, min(1.0, (x2 - x1) / image_width)), 6),
                round(max(0.0, min(1.0, (y2 - y1) / image_height)), 6),
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
                step = max(1, len(points) // 500)
                points = points[::step]

            polygon = [
                [
                    round(max(0.0, min(1.0, float(x) / image_width)), 6),
                    round(max(0.0, min(1.0, float(y) / image_height)), 6),
                ]
                for x, y in points
            ]
            if len(polygon) >= 3:
                entry["polygon"] = polygon

        detections.append(entry)
        if len(detections) >= MAX_DETECTIONS_PER_MODEL:
            break

    return detections


def _merge_detections(items: list[dict]) -> list[dict]:
    """
    Une resultados de modelos distintos y elimina cajas duplicadas de la
    misma clase. Conserva la detección con mayor confianza.
    """
    items = sorted(items, key=lambda item: item["score"], reverse=True)
    merged: list[dict] = []

    for item in items:
        duplicate_index = None
        for idx, current in enumerate(merged):
            if (
                item["label"].lower() == current["label"].lower()
                and _iou(item["bbox"], current["bbox"]) >= DUPLICATE_IOU_THRESHOLD
            ):
                duplicate_index = idx
                break

        if duplicate_index is None:
            merged.append(item)
        elif "polygon" in item and "polygon" not in merged[duplicate_index]:
            # Si la caja duplicada del modelo de segmentación tiene máscara,
            # conservar la máscara aunque la caja de mayor confianza venga
            # del modelo general.
            merged[duplicate_index]["polygon"] = item["polygon"]

    return merged


def _run_model(model_name: str, image: Image.Image, confidence: float,
               source: str, include_masks: bool) -> list[dict]:
    detector = load_model(model_name)
    result = detector.predict(
        source=image,
        conf=confidence,
        verbose=False,
        max_det=MAX_DETECTIONS_PER_MODEL,
    )[0]
    return _extract_result(
        result,
        image.width,
        image.height,
        source,
        include_masks=include_masks,
    )


def _load_image(data: bytes) -> Image.Image:
    if not data:
        raise HTTPException(status_code=400, detail="No se recibió ninguna imagen.")
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="El tamaño máximo permitido es 12 MB.")

    try:
        image = Image.open(io.BytesIO(data))
        image.verify()
        image = Image.open(io.BytesIO(data)).convert("RGB")
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise HTTPException(
            status_code=400,
            detail="El archivo no es una imagen JPEG, PNG o WebP válida.",
        ) from exc

    if image.width < 64 or image.height < 64:
        raise HTTPException(status_code=400, detail="La imagen debe medir al menos 64 x 64 píxeles.")
    if image.width * image.height > MAX_PIXELS:
        raise HTTPException(status_code=413, detail="La imagen supera el límite de píxeles permitido.")

    return image


@app.get("/health")
def health():
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
        "note": (
            "El modelo industrial solo estará activo si YOLO_SAFETY_MODEL apunta "
            "a un archivo .pt válido y entrenado para las clases deseadas."
        ),
    }


@app.post("/detect")
@app.post("/segment")
async def analyze(request: Request, confidence: float = 0.25):
    if not 0.01 <= confidence <= 0.99:
        raise HTTPException(status_code=400, detail="Confianza fuera de rango (0.01 a 0.99).")

    content_type = request.headers.get("content-type", "").split(";")[0].strip().lower()
    accepted_types = {
        "image/jpeg",
        "image/png",
        "image/webp",
        "application/octet-stream",
    }
    if content_type not in accepted_types:
        raise HTTPException(
            status_code=415,
            detail="Se requiere una imagen JPEG, PNG, WebP o application/octet-stream.",
        )

    image = _load_image(await request.body())
    is_segment = request.url.path.endswith("/segment")
    started = time.perf_counter()

    try:
        results: list[dict] = []

        if is_segment:
            # El modelo -seg devuelve máscaras cuando su arquitectura y pesos
            # realmente son de segmentación.
            results.extend(
                _run_model(
                    SEG_MODEL_NAME,
                    image,
                    confidence,
                    source="yolo-seg",
                    include_masks=True,
                )
            )
        else:
            results.extend(
                _run_model(
                    MODEL_NAME,
                    image,
                    confidence,
                    source="yolo-general",
                    include_masks=False,
                )
            )

        # El modelo industrial es opcional. Se ejecuta además del modelo
        # general para sumar clases entrenadas sin perder personas/vehículos.
        if SAFETY_MODEL_NAME:
            results.extend(
                _run_model(
                    SAFETY_MODEL_NAME,
                    image,
                    confidence,
                    source="yolo-safety",
                    include_masks=is_segment,
                )
            )

        detections = _merge_detections(results)
        elapsed_ms = round((time.perf_counter() - started) * 1000)

        used_models = (
            [SEG_MODEL_NAME] if is_segment else [MODEL_NAME]
        )
        if SAFETY_MODEL_NAME:
            used_models.append(SAFETY_MODEL_NAME)

        return {
            "ok": True,
            "model": " + ".join(used_models),
            "models": used_models,
            "width": image.width,
            "height": image.height,
            "duration_ms": elapsed_ms,
            "detections": detections,
            "segmentation": is_segment,
            "masks_count": sum(1 for item in detections if "polygon" in item),
            "safety_model_used": bool(SAFETY_MODEL_NAME),
        }

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"No se pudo ejecutar YOLO: {str(exc)[:300]}",
        ) from exc

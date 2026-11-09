
import os
import tempfile
from pathlib import Path

from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException, Request
from inference_sdk import InferenceHTTPClient

load_dotenv(Path(__file__).resolve().parent / ".env")

router = APIRouter()

MODEL_ID = os.getenv(
    "ROBOFLOW_QA_MODEL",
    "cardboard-boxes-4h3rr-ryjj2/1"
)
API_URL = os.getenv(
    "ROBOFLOW_API_URL",
    "https://serverless.roboflow.com"
)

@router.post("/quality")
async def analyze_quality(request: Request):
    api_key = os.getenv("ROBOFLOW_API_KEY")

    if not api_key:
        raise HTTPException(
            503,
            "Falta configurar ROBOFLOW_API_KEY"
        )

    data = await request.body()

    if not data or len(data) > 12 * 1024 * 1024:
        raise HTTPException(
            400, "Imagen vacía o superior a 12 MB"
        )

    from PIL import Image, UnidentifiedImageError
    import io

    try:
        image = Image.open(io.BytesIO(data))
        image.verify()
        image = Image.open(io.BytesIO(data)).convert("RGB")
    except (UnidentifiedImageError, OSError, ValueError):
        raise HTTPException(400, "Imagen inválida")

    if image.width < 64 or image.height < 64:
        raise HTTPException(400, "Imagen demasiado pequeña")

    if image.width * image.height > 30_000_000:
        raise HTTPException(413, "Imagen demasiado grande")

    path = None

    try:
        with tempfile.NamedTemporaryFile(
            suffix=".jpg", delete=False
        ) as tmp:
            path = tmp.name

        image.save(path, format="JPEG", quality=90)

        client = InferenceHTTPClient(
            api_url=API_URL,
            api_key=api_key
        )

        result = client.infer(
            path,
            model_id=MODEL_ID
        )

        detections = []

        for p in result.get("predictions", []):
            x = float(p["x"])
            y = float(p["y"])
            w = float(p["width"])
            h = float(p["height"])
            label = str(p.get("class", "unknown"))
            score = float(p.get("confidence", 0))

            detections.append({
                "label": label,
                "score": round(score, 5),
                "bbox": [
                    max(0, (x - w / 2) / image.width),
                    max(0, (y - h / 2) / image.height),
                    min(1, w / image.width),
                    min(1, h / image.height)
                ],
                "source": "roboflow-quality"
            })

        return {
            "ok": True,
            "model": MODEL_ID,
            "width": image.width,
            "height": image.height,
            "detections": detections,
            "total": len(detections),
            "damaged": sum(
                1 for d in detections
                if d["label"].lower() == "damaged box"
            )
        }

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            502,
            f"Error en Roboflow: {str(exc)[:250]}"
        ) from exc

    finally:
        if path:
            Path(path).unlink(missing_ok=True)

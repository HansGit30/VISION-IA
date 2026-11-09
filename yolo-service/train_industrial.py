"""Entrena un detector industrial a partir de un dataset YOLO etiquetado."""
import argparse
from pathlib import Path
from ultralytics import YOLO


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', default='dataset/data.yaml')
    parser.add_argument('--epochs', type=int, default=80)
    parser.add_argument('--imgsz', type=int, default=640)
    parser.add_argument('--batch', type=int, default=8)
    parser.add_argument('--device', default='cpu')
    parser.add_argument('--base', default='yolo11n.pt')
    args = parser.parse_args()
    if not Path(args.data).is_file():
        raise SystemExit(f'Falta dataset YAML: {args.data}. Descarga y etiqueta primero tus imágenes.')
    model = YOLO(args.base)
    model.train(data=args.data, epochs=args.epochs, imgsz=args.imgsz,
                batch=args.batch, device=args.device,
                project='runs/industrial', name='safety', exist_ok=True)
    print('Pesos entrenados: runs/industrial/safety/weights/best.pt')


if __name__ == '__main__':
    main()

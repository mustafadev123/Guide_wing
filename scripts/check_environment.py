r"""Verify the GuideWing Python environment: interpreter, imports, versions and model loading.

Usage (from the repo root):
    .\.venv\Scripts\python.exe scripts\check_environment.py [--sample-image PATH]

Runs real inference with the pretrained detector on Ultralytics' bundled bus.jpg
and with the gesture recognizer on --sample-image (or a blank frame). It does not
open a camera; use scripts\test_camera.py for that.
"""

import argparse
import importlib
import os
import sys
import time
from pathlib import Path

os.environ.setdefault("YOLO_OFFLINE", "1")  # never auto-install or phone home

REPO = Path(__file__).resolve().parents[1]
MODELS = REPO / "models"
PACKAGES = [
    "fastapi", "uvicorn", "pydantic", "starlette", "httpx", "pytest", "numpy",
    "cv2", "torch", "torchvision", "ultralytics", "mediapipe", "PIL",
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample-image", type=Path, help="hand image for the gesture model")
    args = ap.parse_args()
    ok = True

    print(f"python      {sys.version.split()[0]}  {sys.executable}")
    if ".venv" not in sys.executable:
        print("WARNING: not running from the project .venv")
        ok = False

    for name in PACKAGES:
        try:
            mod = importlib.import_module(name)
            print(f"{name:<12}{getattr(mod, '__version__', '?'):<14}{Path(mod.__file__).parent}")
        except Exception as e:  # noqa: BLE001 - report every failure
            print(f"{name:<12}IMPORT FAILED: {e}")
            ok = False

    import cv2
    import numpy as np

    print(f"cv2 build   contrib={hasattr(cv2, 'ximgproc')}  (one OpenCV distribution owns cv2)")

    # Detector
    try:
        from ultralytics import YOLO
        from ultralytics.utils import ASSETS

        model = YOLO(str(MODELS / "yolo26n.pt"))
        img = cv2.imread(str(ASSETS / "bus.jpg"))
        model.predict(img, imgsz=640, device="cpu", verbose=False)  # warm-up
        t = time.perf_counter()
        res = model.predict(img, imgsz=640, device="cpu", verbose=False)[0]
        ms = (time.perf_counter() - t) * 1000
        names = [res.names[int(c)] for c in res.boxes.cls.tolist()]
        print(f"detector    OK  {ms:.0f} ms/frame CPU, bus.jpg -> {sorted(set(names))}")
        print(f"            'chair' class id: {[k for k, v in res.names.items() if v == 'chair']}")
    except Exception as e:  # noqa: BLE001
        print(f"detector    FAILED: {e}")
        ok = False

    # Gesture recognizer (MediaPipe Tasks)
    try:
        import mediapipe as mp
        from mediapipe.tasks.python import BaseOptions
        from mediapipe.tasks.python.vision import (
            GestureRecognizer, GestureRecognizerOptions, RunningMode,
        )

        opts = GestureRecognizerOptions(
            base_options=BaseOptions(model_asset_path=str(MODELS / "gesture_recognizer.task")),
            running_mode=RunningMode.IMAGE,
        )
        with GestureRecognizer.create_from_options(opts) as rec:
            if args.sample_image:
                rgb = cv2.cvtColor(cv2.imread(str(args.sample_image)), cv2.COLOR_BGR2RGB)
            else:
                rgb = np.zeros((480, 640, 3), np.uint8)
            t = time.perf_counter()
            out = rec.recognize(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
            ms = (time.perf_counter() - t) * 1000
            top = [(g[0].category_name, round(g[0].score, 2)) for g in out.gestures]
            print(f"gesture     OK  {ms:.0f} ms/frame CPU, result: {top or 'no hand'}")
    except Exception as e:  # noqa: BLE001
        print(f"gesture     FAILED: {e}")
        ok = False

    print("RESULT:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

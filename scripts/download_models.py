r"""Download the two pretrained model files into models\ from their official sources.

    .\.venv\Scripts\python.exe scripts\download_models.py

  yolo26n.pt               Ultralytics release assets (AGPL-3.0)
  gesture_recognizer.task  Google MediaPipe model bucket (Apache-2.0)
"""

import os
import urllib.request
from pathlib import Path

MODELS = Path(__file__).resolve().parents[1] / "models"
GESTURE_URL = (
    "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/"
    "gesture_recognizer/float16/latest/gesture_recognizer.task"
)


def main():
    MODELS.mkdir(exist_ok=True)
    gesture = MODELS / "gesture_recognizer.task"
    if not gesture.exists():
        print("downloading", GESTURE_URL)
        urllib.request.urlretrieve(GESTURE_URL, gesture)
    print("gesture model:", gesture, gesture.stat().st_size, "bytes")

    detector = MODELS / "yolo26n.pt"
    if not detector.exists():
        os.environ.setdefault("YOLO_OFFLINE", "1")
        from ultralytics.utils.downloads import attempt_download_asset

        attempt_download_asset(str(detector))
    print("detector model:", detector, detector.stat().st_size, "bytes")


if __name__ == "__main__":
    main()

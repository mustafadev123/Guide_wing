"""Blurred incident snapshot. The whole frame is pixelated and blurred in memory;
only the processed JPEG is ever written. If anything fails, no image is kept.
This is a blurred snapshot, not guaranteed anonymization.
"""

import logging
from pathlib import Path

log = logging.getLogger("guidewing.snapshot")


def blur_full_frame(frame_bgr) -> bytes:
    import cv2

    h, w = frame_bgr.shape[:2]
    small = cv2.resize(frame_bgr, (max(1, w // 24), max(1, h // 24)), interpolation=cv2.INTER_AREA)
    pixelated = cv2.resize(small, (w, h), interpolation=cv2.INTER_NEAREST)
    blurred = cv2.GaussianBlur(pixelated, (0, 0), sigmaX=9)
    ok, buf = cv2.imencode(".jpg", blurred, [cv2.IMWRITE_JPEG_QUALITY, 70])
    if not ok:
        raise RuntimeError("jpeg encode failed")
    return buf.tobytes()


def save_blurred_snapshot(frame_bgr, directory: Path, incident_id: str) -> str | None:
    try:
        data = blur_full_frame(frame_bgr)  # processed before any file write
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"{incident_id}.jpg"
        path.write_bytes(data)
        return str(path)
    except Exception:  # noqa: BLE001 - omit the image on any failure
        log.exception("snapshot omitted")
        return None

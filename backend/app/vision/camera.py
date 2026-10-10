"""Open a camera by index, trying Windows capture backends in order.

Some virtual cameras (e.g. DroidCam) only deliver frames through Media
Foundation (MSMF) and fail under DirectShow, while others are the reverse.
A backend counts as working only if it actually returns a frame.
"""

import os
import time

import cv2

WINDOWS_BACKENDS = (("MSMF", cv2.CAP_MSMF), ("DSHOW", cv2.CAP_DSHOW))


def open_camera(index: int, width: int = 640, height: int = 480, first_frame_timeout_s: float = 4.0):
    """Return (capture, backend_name). The capture is released and None returned on failure."""
    backends = WINDOWS_BACKENDS if os.name == "nt" else (("ANY", cv2.CAP_ANY),)
    for name, api in backends:
        cap = None
        try:
            cap = cv2.VideoCapture(index, api)
            if not cap.isOpened():
                cap.release()
                continue
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
            deadline = time.monotonic() + first_frame_timeout_s
            while time.monotonic() < deadline:
                ok, _ = cap.read()
                if ok:
                    return cap, name
            cap.release()
        except cv2.error:
            if cap is not None:
                cap.release()
    return None, None

r"""Open a webcam index or a video file and show frames until Q is pressed.

    .\.venv\Scripts\python.exe scripts\test_camera.py 0
    .\.venv\Scripts\python.exe scripts\test_camera.py 1            # e.g. DroidCam / phone webcam
    .\.venv\Scripts\python.exe scripts\test_camera.py path\to\clip.mp4
    .\.venv\Scripts\python.exe scripts\test_camera.py --list       # probe indexes 0-4

Close any other app that uses the camera first (the backend owns the camera while running).
"""

import os
import sys
import time

import cv2


def open_source(src: str):
    if src.isdigit():
        return cv2.VideoCapture(int(src), cv2.CAP_DSHOW if os.name == "nt" else cv2.CAP_ANY)
    return cv2.VideoCapture(src)


def main() -> int:
    arg = sys.argv[1] if len(sys.argv) > 1 else "0"
    if arg == "--list":
        for i in range(5):
            cap = open_source(str(i))
            ok = cap.isOpened() and cap.read()[0]
            print(f"index {i}: {'frames OK' if ok else 'not available'}")
            cap.release()
        return 0

    cap = open_source(arg)
    try:
        if not cap.isOpened():
            print(f"FAIL: cannot open {arg!r}. Is another app using the camera, or is camera permission off "
                  "(Settings > Privacy & security > Camera > Let desktop apps access your camera)?")
            return 1
        frames, t0, failures = 0, time.monotonic(), 0
        while True:
            ok, frame = cap.read()
            if not ok:
                failures += 1
                if failures > 30:
                    print("FAIL: frame reads keep failing")
                    return 1
                continue
            frames += 1
            fps = frames / max(1e-6, time.monotonic() - t0)
            cv2.putText(frame, f"{frame.shape[1]}x{frame.shape[0]}  {fps:.1f} fps  (Q to quit)", (8, 22),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
            cv2.imshow("GuideWing camera test", frame)
            if cv2.waitKey(1) & 0xFF in (ord("q"), ord("Q")):
                break
        print(f"OK: {frames} frames at {fps:.1f} fps, {frame.shape[1]}x{frame.shape[0]}")
        return 0
    finally:
        cap.release()
        cv2.destroyAllWindows()


if __name__ == "__main__":
    sys.exit(main())

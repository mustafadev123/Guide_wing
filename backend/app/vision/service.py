"""Vision service: one camera owner, latest-frame buffering, inference off the API loop.

Threads:
  capture   reads frames into a single latest-frame slot (stale frames are overwritten)
  inference takes the newest frame, runs the detector + gesture recognizer,
            feeds temporal logic, and publishes an annotated JPEG for /api/vision/stream

Input modes (reported honestly in status):
  live         webcam index (GUIDEWING_VISION_SOURCE=0)
  replay       prerecorded video file, looped and paced at its own FPS
  unavailable  not configured, failed to open, model missing or camera lost
  test         set only on developer-injected observations; never shown as live
"""

import logging
import os
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from ..clock import utc_iso
from ..config import VisionSettings
from ..schemas import VisionStatus
from .logic import ObstructionMonitor, PalmHoldDetector, overlap_fraction

log = logging.getLogger("guidewing.vision")

STALE_FRAME_S = 2.0


@dataclass
class VisionContext:
    journey_id: str | None
    armed: bool
    incident_open: bool


@dataclass
class VisionHooks:
    context: Callable[[], VisionContext]
    on_palm_hold: Callable[[str, str], None]  # (journey_id, request_source)
    on_obstruction: Callable[[str, bool, bool, str], None]  # (journey_id|None, active, warn, source)
    on_status_change: Callable[[VisionStatus], None]


class VisionService:
    def __init__(self, settings: VisionSettings, clock):
        self.s = settings
        self.clock = clock
        self.hooks: VisionHooks | None = None
        self._lock = threading.Lock()
        self._frame_cond = threading.Condition(self._lock)
        self._stop = threading.Event()
        self._threads: list[threading.Thread] = []
        self._latest = None  # (seq, frame_bgr, t_mono)
        self._seq = 0
        self._jpeg: bytes | None = None
        self._jpeg_seq = 0
        self.mode = "unavailable"
        self.source_label: str | None = None
        self.ready = False
        self.error: str | None = "vision not configured (set GUIDEWING_VISION_SOURCE)" if not settings.source else None
        self.last_observed_wall: str | None = None
        self.last_frame_mono: float | None = None
        self.fps: float | None = None
        self.inference_ms: float | None = None
        self.palm = PalmHoldDetector(settings.palm_hold_s, settings.palm_gap_tolerance_s, settings.palm_release_s)
        self.obstruction = ObstructionMonitor(
            settings.obstruction_persist_s, settings.obstruction_clear_s, settings.obstruction_cooldown_s
        )
        self.obstruction_source: str | None = None
        self.hold_progress = 0.0
        self._last_status_key = None

    # ---- status -----------------------------------------------------------

    def status(self) -> VisionStatus:
        with self._lock:
            age = None if self.last_frame_mono is None else round(time.monotonic() - self.last_frame_mono, 2)
            ready = self.ready and age is not None and age < STALE_FRAME_S
            error = self.error
            if self.ready and not ready:
                error = error or f"no fresh frame for {age}s"
            return VisionStatus(
                input_mode=self.mode,
                ready=ready,
                source_label=self.source_label,
                error=error,
                last_observed_at=self.last_observed_wall,
                frame_age_s=age,
                fps=self.fps,
                inference_ms=self.inference_ms,
                obstruction_active=self.obstruction.active,
                obstruction_source=self.obstruction_source if self.obstruction.active else None,
                gesture_armed=not self.palm.latched,
                gesture_hold_progress=round(self.hold_progress, 2),
            )

    def _status_changed(self) -> None:
        st = self.status()
        key = (st.input_mode, st.ready, st.error, st.obstruction_active)
        if key != self._last_status_key:
            self._last_status_key = key
            if self.hooks:
                self.hooks.on_status_change(st)

    # ---- lifecycle --------------------------------------------------------

    def start(self) -> None:
        if not self.s.source:
            return
        src = self.s.source
        is_index = src.isdigit()
        if not is_index and not Path(src).exists():
            self._fail(f"video file not found: {src}")
            return
        for path in (self.s.detector_model, self.s.gesture_model):
            if not Path(path).exists():
                self._fail(f"model file missing: {path} (run scripts\\download_models.py)")
                return
        self.mode = "live" if is_index else "replay"
        self.source_label = f"webcam index {src}" if is_index else f"replay file {Path(src).name}"
        self._stop.clear()
        self._threads = [
            threading.Thread(target=self._capture_loop, name="vision-capture", daemon=True),
            threading.Thread(target=self._inference_loop, name="vision-inference", daemon=True),
        ]
        for t in self._threads:
            t.start()

    def stop(self) -> None:
        self._stop.set()
        with self._frame_cond:
            self._frame_cond.notify_all()
        for t in self._threads:
            t.join(timeout=5)
        self._threads = []

    def _fail(self, message: str) -> None:
        log.error("vision unavailable: %s", message)
        with self._lock:
            self.mode = "unavailable"
            self.ready = False
            self.error = message
        self._status_changed()

    # ---- capture ----------------------------------------------------------

    def _open(self):
        import cv2

        src = self.s.source
        if src.isdigit():
            cap = cv2.VideoCapture(int(src), cv2.CAP_DSHOW if os.name == "nt" else cv2.CAP_ANY)
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        else:
            cap = cv2.VideoCapture(src)
        return cap

    def _capture_loop(self) -> None:
        import cv2

        cap = None
        replay = self.mode == "replay"
        try:
            while not self._stop.is_set():
                if cap is None or not cap.isOpened():
                    cap = self._open()
                    if not cap.isOpened():
                        self._set_error(f"cannot open {self.source_label}; retrying (camera in use or permission denied?)")
                        self._stop.wait(2.0)
                        continue
                    fps = cap.get(cv2.CAP_PROP_FPS) or 0
                    frame_interval = 1.0 / fps if replay and 1 <= fps <= 120 else 0.0
                ok, frame = cap.read()
                if not ok:
                    if replay:
                        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)  # loop the replay file
                        continue
                    self._set_error(f"frame read failed from {self.source_label}; reopening")
                    cap.release()
                    cap = None
                    self._stop.wait(1.0)
                    continue
                with self._frame_cond:
                    self._seq += 1
                    self._latest = (self._seq, frame, time.monotonic())
                    self._frame_cond.notify_all()
                if frame_interval:
                    self._stop.wait(frame_interval)
        finally:
            if cap is not None:
                cap.release()
            log.info("vision capture released")

    def _set_error(self, message: str) -> None:
        with self._lock:
            changed = self.error != message or self.ready
            self.error = message
            self.ready = False
        if changed:
            log.warning(message)
            self._status_changed()

    # ---- inference --------------------------------------------------------

    def _load_models(self):
        os.environ.setdefault("YOLO_OFFLINE", "1")
        import mediapipe as mp
        from mediapipe.tasks.python import BaseOptions
        from mediapipe.tasks.python.vision import GestureRecognizer, GestureRecognizerOptions, RunningMode
        from ultralytics import YOLO

        detector = YOLO(str(self.s.detector_model))
        names = detector.names
        chair_ids = [k for k, v in names.items() if v == "chair"]
        person_ids = [k for k, v in names.items() if v == "person"]
        recognizer = GestureRecognizer.create_from_options(
            GestureRecognizerOptions(
                base_options=BaseOptions(model_asset_path=str(self.s.gesture_model)),
                running_mode=RunningMode.VIDEO,
                num_hands=1,
            )
        )
        return mp, detector, recognizer, chair_ids, person_ids

    def _inference_loop(self) -> None:
        import cv2

        try:
            mp, detector, recognizer, chair_ids, person_ids = self._load_models()
        except Exception as e:  # noqa: BLE001
            self._fail(f"model load failed: {e}")
            return
        last_seq = 0
        last_ts_ms = -1
        frame_times: list[float] = []
        try:
            while not self._stop.is_set():
                with self._frame_cond:
                    while not self._stop.is_set() and (self._latest is None or self._latest[0] == last_seq):
                        self._frame_cond.wait(timeout=1.0)
                    if self._stop.is_set():
                        break
                    seq, frame, t = self._latest
                last_seq = seq
                started = time.perf_counter()
                h, w = frame.shape[:2]

                det = detector.predict(
                    frame, imgsz=self.s.inference_width, device="cpu", verbose=False,
                    classes=chair_ids + person_ids, conf=min(self.s.chair_confidence, self.s.person_confidence),
                )[0]
                chairs, people = [], []
                for (x1, y1, x2, y2), cls, conf in zip(
                    det.boxes.xyxy.tolist(), det.boxes.cls.tolist(), det.boxes.conf.tolist()
                ):
                    box = (x1 / w, y1 / h, x2 / w, y2 / h)
                    if int(cls) in chair_ids and conf >= self.s.chair_confidence:
                        chairs.append((box, conf, overlap_fraction(box, self.s.path_region)))
                    elif int(cls) in person_ids and conf >= self.s.person_confidence:
                        people.append((box, conf))  # overlay only; never an obstacle

                ts_ms = max(int(t * 1000), last_ts_ms + 1)
                last_ts_ms = ts_ms
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                g = recognizer.recognize_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), ts_ms)
                palm_score = 0.0
                hand_label = None
                for gestures in g.gestures:
                    if gestures:
                        top = gestures[0]
                        hand_label = f"{top.category_name} {top.score:.2f}"
                        if top.category_name == "Open_Palm":
                            palm_score = max(palm_score, top.score)

                self._apply_observations(t, chairs, palm_score >= self.s.palm_score)
                elapsed_ms = (time.perf_counter() - started) * 1000
                frame_times.append(time.monotonic())
                frame_times = frame_times[-20:]
                fps = (len(frame_times) - 1) / (frame_times[-1] - frame_times[0]) if len(frame_times) > 1 else None

                jpeg = self._annotate(frame, chairs, people, g, hand_label)
                with self._lock:
                    self._jpeg = jpeg
                    self._jpeg_seq += 1
                    self.ready = True
                    self.error = None
                    self.last_frame_mono = time.monotonic()
                    self.last_observed_wall = utc_iso(self.clock.now())
                    self.inference_ms = round(elapsed_ms, 1)
                    self.fps = round(fps, 1) if fps else None
                self._status_changed()
        except Exception as e:  # noqa: BLE001
            log.exception("vision inference crashed")
            self._fail(f"inference error: {e}")
        finally:
            recognizer.close()
            log.info("vision models released")

    def _apply_observations(self, t: float, chairs, palm: bool) -> None:
        if not self.hooks:
            return
        ctx = self.hooks.context()
        present = any(c[2] >= self.s.region_overlap for c in chairs)
        upd = self.obstruction.update(t, present)
        if upd.became_active or upd.cleared:
            if upd.became_active:
                self.obstruction_source = self.mode
            self.hooks.on_obstruction(ctx.journey_id, upd.active, upd.warn, self.mode)
        p = self.palm.update(t, palm, ctx.armed, ctx.incident_open)
        self.hold_progress = p.hold_progress
        if p.triggered and ctx.journey_id:
            self.hooks.on_palm_hold(ctx.journey_id, "gesture")

    def _annotate(self, frame, chairs, people, gesture_result, hand_label) -> bytes:
        import cv2

        img = frame.copy()
        h, w = img.shape[:2]
        rx1, ry1, rx2, ry2 = self.s.path_region
        region_color = (0, 0, 255) if self.obstruction.active else (0, 200, 255)
        cv2.rectangle(img, (int(rx1 * w), int(ry1 * h)), (int(rx2 * w), int(ry2 * h)), region_color, 2)
        cv2.putText(img, "monitored path region", (int(rx1 * w) + 4, int(ry1 * h) + 18),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, region_color, 1)
        for (x1, y1, x2, y2), conf, ov in chairs:
            cv2.rectangle(img, (int(x1 * w), int(y1 * h)), (int(x2 * w), int(y2 * h)), (0, 0, 255), 2)
            cv2.putText(img, f"chair {conf:.2f} overlap {ov:.2f}", (int(x1 * w), max(12, int(y1 * h) - 4)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 1)
        for (x1, y1, x2, y2), conf in people:
            cv2.rectangle(img, (int(x1 * w), int(y1 * h)), (int(x2 * w), int(y2 * h)), (255, 160, 0), 1)
            cv2.putText(img, f"person {conf:.2f} (overlay)", (int(x1 * w), max(12, int(y1 * h) - 4)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 160, 0), 1)
        for hand in gesture_result.hand_landmarks:
            for lm in hand:
                cv2.circle(img, (int(lm.x * w), int(lm.y * h)), 2, (0, 255, 0), -1)
        label = {"live": "LIVE", "replay": "REPLAY"}.get(self.mode, self.mode.upper())
        cv2.rectangle(img, (0, 0), (w, 24), (0, 0, 0), -1)
        status = f"{label} | hand: {hand_label or '-'} | hold {self.hold_progress:.0%}"
        if self.palm.latched:
            status += " | release palm to rearm"
        cv2.putText(img, status, (6, 17), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
        ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 70])
        return buf.tobytes() if ok else b""

    # ---- outputs ----------------------------------------------------------

    def latest_jpeg(self) -> tuple[int, bytes | None]:
        with self._lock:
            return self._jpeg_seq, self._jpeg

    def latest_raw_frame(self):
        """Raw frame stays in memory only; callers must blur before any write."""
        with self._lock:
            if self._latest is None or self.mode not in ("live", "replay"):
                return None
            age = time.monotonic() - self._latest[2]
            return self._latest[1].copy() if age < STALE_FRAME_S else None

    # ---- developer test observations (labeled "test", never "live") ------

    def inject_test(self, kind: str) -> None:
        if not self.hooks:
            return
        ctx = self.hooks.context()
        if kind == "obstruction":
            self.obstruction.active = True
            self.obstruction_source = "test"
            self.hooks.on_obstruction(ctx.journey_id, True, True, "test")
        elif kind == "clear":
            self.obstruction.active = False
            self.hooks.on_obstruction(ctx.journey_id, False, False, "test")
        elif kind == "palm":
            if ctx.journey_id:
                self.hooks.on_palm_hold(ctx.journey_id, "test")
        else:
            raise ValueError(kind)
        self._status_changed()

"""Runtime settings, read from environment variables (see .env.example)."""

import os
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def _env(name: str, default: str) -> str:
    return os.getenv(name, default).strip()


def _env_float(name: str, default: float) -> float:
    return float(_env(name, str(default)))


def _env_bool(name: str, default: bool) -> bool:
    return _env(name, "1" if default else "0").lower() in {"1", "true", "yes", "on"}


def _region(value: str) -> tuple[float, float, float, float]:
    x1, y1, x2, y2 = (float(v) for v in value.split(","))
    if not (0 <= x1 < x2 <= 1 and 0 <= y1 < y2 <= 1):
        raise ValueError(f"path region must be normalized x1,y1,x2,y2: {value!r}")
    return x1, y1, x2, y2


@dataclass
class VisionSettings:
    # "" = disabled (unavailable), "0"/"1" = webcam index, otherwise a video file path.
    source: str = ""
    detector_model: Path = REPO_ROOT / "models" / "yolo26n.pt"
    gesture_model: Path = REPO_ROOT / "models" / "gesture_recognizer.task"
    inference_width: int = 640
    chair_confidence: float = 0.45
    person_confidence: float = 0.5
    path_region: tuple[float, float, float, float] = (0.25, 0.45, 0.75, 1.0)
    region_overlap: float = 0.25
    obstruction_persist_s: float = 1.0
    obstruction_clear_s: float = 1.5
    obstruction_cooldown_s: float = 10.0
    palm_score: float = 0.6
    palm_hold_s: float = 2.0
    palm_gap_tolerance_s: float = 0.35
    palm_release_s: float = 1.0
    # Optional blurred incident snapshot (whole frame is blurred in memory first).
    snapshots: bool = True


@dataclass
class Settings:
    db_path: Path = REPO_ROOT / "backend" / "data" / "guidewing.sqlite3"
    route_path: Path = REPO_ROOT / "backend" / "app" / "route_campus_demo_v1.json"
    snapshot_dir: Path = REPO_ROOT / "backend" / "data" / "snapshots"
    frontend_dist: Path = REPO_ROOT / "frontend" / "dist"
    cancel_window_s: float = 10.0
    route_duration_s: float = 180.0  # seconds of walking (pauses excluded)
    tick_s: float = 0.25
    dev_controls: bool = True
    cors_origins: list[str] = field(
        default_factory=lambda: ["http://localhost:5173", "http://127.0.0.1:5173"]
    )
    vision: VisionSettings = field(default_factory=VisionSettings)
    # Optional sponsor providers (keys from the environment only; never logged or returned)
    elevenlabs_api_key: str = ""
    elevenlabs_voice_id: str = "JBFqnCBsd6RMkjVDRZzb"
    elevenlabs_model_id: str = "eleven_flash_v2_5"
    tts_cache_dir: Path = REPO_ROOT / "backend" / "data" / "tts_cache"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.8-flash"
    gemini_analytics_model: str = "gemini-3.8-flash"


def load_settings() -> Settings:
    s = Settings()
    if v := os.getenv("GUIDEWING_DB_PATH"):
        s.db_path = Path(v)
    s.cancel_window_s = _env_float("GUIDEWING_CANCEL_WINDOW_S", s.cancel_window_s)
    s.route_duration_s = _env_float("GUIDEWING_ROUTE_DURATION_S", s.route_duration_s)
    s.dev_controls = _env_bool("GUIDEWING_DEV_CONTROLS", s.dev_controls)
    if v := os.getenv("GUIDEWING_CORS_ORIGINS"):
        s.cors_origins = [o.strip() for o in v.split(",") if o.strip()]

    s.elevenlabs_api_key = _env("ELEVENLABS_API_KEY", "")
    s.elevenlabs_voice_id = _env("ELEVENLABS_VOICE_ID", s.elevenlabs_voice_id)
    s.elevenlabs_model_id = _env("ELEVENLABS_MODEL_ID", s.elevenlabs_model_id)
    s.gemini_api_key = _env("GEMINI_API_KEY", "")
    s.gemini_model = _env("GEMINI_MODEL", s.gemini_model)
    s.gemini_analytics_model = _env("GEMINI_ANALYTICS_MODEL", s.gemini_analytics_model)

    vs = s.vision
    vs.source = _env("GUIDEWING_VISION_SOURCE", vs.source)
    if v := os.getenv("GUIDEWING_DETECTOR_MODEL"):
        vs.detector_model = Path(v)
    if v := os.getenv("GUIDEWING_GESTURE_MODEL"):
        vs.gesture_model = Path(v)
    vs.chair_confidence = _env_float("GUIDEWING_CHAIR_CONFIDENCE", vs.chair_confidence)
    vs.region_overlap = _env_float("GUIDEWING_REGION_OVERLAP", vs.region_overlap)
    if v := os.getenv("GUIDEWING_PATH_REGION"):
        vs.path_region = _region(v)
    vs.obstruction_persist_s = _env_float("GUIDEWING_OBSTRUCTION_PERSIST_S", vs.obstruction_persist_s)
    vs.obstruction_cooldown_s = _env_float("GUIDEWING_OBSTRUCTION_COOLDOWN_S", vs.obstruction_cooldown_s)
    vs.palm_score = _env_float("GUIDEWING_PALM_SCORE", vs.palm_score)
    vs.palm_hold_s = _env_float("GUIDEWING_PALM_HOLD_S", vs.palm_hold_s)
    vs.snapshots = _env_bool("GUIDEWING_SNAPSHOTS", vs.snapshots)
    return s

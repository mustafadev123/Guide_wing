"""Injectable clocks so lifecycle tests never sleep for real deadlines."""

import threading
from datetime import datetime, timedelta, timezone


def utc_iso(dt: datetime | None) -> str | None:
    """ISO-8601 UTC with a Z suffix (parseable by FDateTime::ParseIso8601)."""
    if dt is None:
        return None
    return dt.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_iso(value: str | None) -> datetime | None:
    if value is None:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


class SystemClock:
    def now(self) -> datetime:
        return datetime.now(timezone.utc)


class FakeClock:
    def __init__(self, start: datetime | None = None):
        self._now = start or datetime(2026, 10, 9, 12, 0, 0, tzinfo=timezone.utc)
        self._lock = threading.Lock()

    def now(self) -> datetime:
        with self._lock:
            return self._now

    def advance(self, seconds: float) -> None:
        with self._lock:
            self._now += timedelta(seconds=seconds)

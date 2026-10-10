import pytest
from fastapi.testclient import TestClient

from backend.app.clock import FakeClock
from backend.app.config import Settings
from backend.app.main import create_app


@pytest.fixture
def clock():
    return FakeClock()


@pytest.fixture
def settings(tmp_path):
    s = Settings()
    s.db_path = tmp_path / "test.sqlite3"
    s.snapshot_dir = tmp_path / "snapshots"
    s.frontend_dist = tmp_path / "no-dist"
    s.vision.source = ""  # unavailable unless a test wires a provider
    return s


class Harness:
    def __init__(self, settings, clock):
        self.settings = settings
        self.clock = clock
        self.app = create_app(settings, clock, start_background=False)
        self.client = TestClient(self.app)
        self.client.__enter__()
        self.svc = self.app.state.services

    def close(self):
        self.client.__exit__(None, None, None)

    # helpers
    def journey_id(self):
        return self.client.get("/api/journeys/current").json()["id"]

    def start(self):
        jid = self.journey_id()
        r = self.client.post(f"/api/journeys/{jid}/start")
        assert r.status_code == 200, r.text
        return jid

    def request_help(self, jid, key="button-key-0001", source="button"):
        return self.client.post("/api/incidents", json={"journey_id": jid, "request_key": key, "request_source": source})

    def tick(self, seconds, step=0.25):
        """Advance like the real ticker: small steps of at most `step` seconds."""
        remaining = seconds
        while remaining > 1e-9:
            dt = min(step, remaining)
            self.clock.advance(dt)
            self.svc.tick(dt)
            remaining -= dt

    def snapshot(self, jid=None):
        r = self.client.get("/api/simulation/state", params={"journey_id": jid} if jid else None)
        assert r.status_code == 200, r.text
        return r.json()


@pytest.fixture
def h(settings, clock):
    harness = Harness(settings, clock)
    yield harness
    harness.close()

"""Shared simulation snapshot, journey progress, location and live events."""

import pytest

from backend.app.simulation import MOCK_SCENARIOS


def keys(obj, prefix=""):
    out = set()
    for k, v in obj.items():
        out.add(prefix + k)
        if isinstance(v, dict):
            out |= keys(v, prefix + k + ".")
    return out


def test_snapshot_shape_and_idle_journey(h):
    snap = h.snapshot()
    assert snap["schema_version"] == 1
    assert snap["data_source"] == "live"
    assert snap["journey"]["status"] == "idle"
    assert snap["journey"]["armed"] is False
    assert snap["journey"]["route_progress"] == 0
    assert snap["journey"]["location"]["source"] == "simulated"
    assert snap["journey"]["location"]["accuracy_m"] is None
    assert snap["active_incident"] is None
    assert snap["last_incident"] is None
    assert snap["vision"]["input_mode"] == "unavailable"


@pytest.mark.parametrize("scenario", MOCK_SCENARIOS)
def test_mock_fixtures_are_labeled_and_shape_compatible(h, scenario):
    mock = h.snapshot(f"mock-{scenario}")
    assert mock["data_source"] == "mock"
    assert mock["journey"]["id"].startswith("mock-")
    live_keys = keys(h.snapshot())
    top = {k for k in live_keys if "." not in k or k.startswith("journey.") or k.startswith("vision.")}
    assert top <= keys(mock) | {"active_incident", "last_incident"}


def test_current_alias_returns_real_journey_uuid(h):
    jid = h.journey_id()
    for params in ({"journey_id": "current"}, None):
        snap = h.client.get("/api/simulation/state", params=params).json()
        assert snap["journey"]["id"] == jid != "current"
    assert h.client.get("/api/simulation/state", params={"journey_id": "demo"}).status_code == 404


def test_mock_states(h):
    assert h.snapshot("mock-paused")["journey"]["status"] == "paused"
    assert h.snapshot("mock-pending")["active_incident"]["status"] == "pending"
    assert h.snapshot("mock-dispatched")["active_incident"]["status"] == "dispatched"
    assert h.snapshot("mock-acknowledged")["active_incident"]["status"] == "acknowledged"
    obstacle = h.snapshot("mock-obstacle")
    assert obstacle["journey"]["pause_reason"] == "obstruction"
    assert obstacle["vision"]["obstruction_active"] is True and obstacle["vision"]["obstruction_source"] == "test"
    resolved = h.snapshot("mock-resolved")
    assert resolved["active_incident"] is None and resolved["last_incident"]["status"] == "resolved"
    cancelled = h.snapshot("mock-cancelled")
    assert cancelled["active_incident"] is None and cancelled["last_incident"]["status"] == "cancelled"
    no_loc = h.snapshot("mock-no-location")["journey"]["location"]
    assert no_loc["source"] == "unavailable" and no_loc["latitude"] is None
    assert h.client.get("/api/simulation/state", params={"journey_id": "mock-bogus"}).status_code == 404


def test_backend_owns_progress(h):
    jid = h.start()
    rev0 = h.snapshot()["revision"]
    h.tick(9)  # 9 s of a 90 s route
    snap = h.snapshot()
    assert snap["journey"]["route_progress"] == pytest.approx(0.1, abs=1e-3)
    assert snap["revision"] > rev0
    # reads never advance the route
    h.clock.advance(5)
    assert h.snapshot()["journey"]["route_progress"] == snap["journey"]["route_progress"]
    # pause freezes, resume is explicit
    h.client.post(f"/api/journeys/{jid}/pause")
    h.tick(10)
    assert h.snapshot()["journey"]["route_progress"] == snap["journey"]["route_progress"]
    h.client.post(f"/api/journeys/{jid}/resume")
    h.tick(9)
    assert h.snapshot()["journey"]["route_progress"] == pytest.approx(0.2, abs=1e-3)


def test_stalled_ticker_does_not_teleport(h):
    h.start()
    h.clock.advance(300)
    h.svc.tick(300)  # one huge gap (e.g. laptop sleep) is capped at 1 s of movement
    assert h.snapshot()["journey"]["route_progress"] < 0.05


def test_arrival_ends_journey(h):
    h.start()
    for _ in range(100):
        h.tick(1)
    j = h.snapshot()["journey"]
    assert j["route_progress"] == 1.0
    assert j["status"] == "ended" and j["armed"] is False
    assert j["waypoint"] == "Bus stop"


def test_invalid_location_rejected(h):
    jid = h.journey_id()
    bad = [
        {"source": "device", "latitude": 91, "longitude": 0},
        {"source": "device", "latitude": 10},
        {"source": "unavailable", "latitude": 1, "longitude": 1},
        {"source": "simulated", "latitude": 1, "longitude": 1},
        {"source": "device", "latitude": 1, "longitude": 1, "accuracy_m": -5},
    ]
    for body in bad:
        assert h.client.post(f"/api/journeys/{jid}/location", json=body).status_code == 422, body


def test_unavailable_location_is_not_zero(h):
    jid = h.start()
    r = h.client.post(f"/api/journeys/{jid}/location", json={"source": "unavailable"})
    assert r.status_code == 200
    loc = h.snapshot()["journey"]["location"]
    assert loc["source"] == "unavailable"
    assert loc["latitude"] is None and loc["longitude"] is None
    inc = h.request_help(jid).json()["incident"]
    assert inc["location"]["source"] == "unavailable"


def test_request_and_acceptance_reach_a_subscribed_second_client(h):
    jid = h.start()
    with h.client.websocket_connect("/ws/events") as ws:
        hello = ws.receive_json()
        assert hello["type"] == "hello"
        iid = h.request_help(jid).json()["incident"]["id"]
        h.tick(10)
        h.client.post(f"/api/incidents/{iid}/accept")
        seen = []
        while len([e for e in seen if e["type"] == "incident.updated"]) < 3:
            seen.append(ws.receive_json())
    incident_events = [e for e in seen if e["type"] == "incident.updated"]
    assert [e["payload"]["transition"] for e in incident_events] == ["created", "dispatched", "acknowledged"]
    seqs = [e["sequence"] for e in seen]
    assert seqs == sorted(seqs) and len(set(seqs)) == len(seqs)
    assert all(e["boot_id"] == hello["boot_id"] for e in seen)


def test_dev_reset_creates_new_journey_and_closes_open_incident(h):
    jid = h.start()
    iid = h.request_help(jid).json()["incident"]["id"]
    new = h.client.post("/api/dev/reset").json()
    assert new["id"] != jid and new["status"] == "idle"
    assert h.client.get(f"/api/incidents/{iid}").json()["status"] == "cancelled"
    assert h.client.get(f"/api/journeys/{jid}").json()["status"] == "ended"


def test_test_injection_is_labeled(h):
    jid = h.start()
    h.client.post("/api/dev/vision/obstruction")
    snap = h.snapshot()
    assert snap["journey"]["pause_reason"] == "obstruction"
    assert snap["vision"]["obstruction_source"] == "test"  # Unreal can label it TEST, not camera
    assert h.client.get("/api/vision/status").json()["obstruction_source"] == "test"
    h.client.post(f"/api/journeys/{jid}/resume")
    h.client.post("/api/dev/vision/palm")
    inc = h.client.get("/api/incidents").json()[0]
    assert inc["request_source"] == "test" and inc["is_test"] is True


def test_briefing_uses_recorded_facts(h):
    jid = h.start()
    iid = h.request_help(jid).json()["incident"]["id"]
    text = h.client.get(f"/api/incidents/{iid}/briefing").json()["text"]
    assert "Simulated location" in text and "Help button" in text


def test_obstruction_not_announced_before_journey_starts(h):
    with h.client.websocket_connect("/ws/events") as ws:
        ws.receive_json()  # hello
        h.client.post("/api/dev/vision/obstruction")  # journey idle
        idle_event = next(e for e in iter(ws.receive_json, None) if e["type"] == "vision.obstacle")
        assert idle_event["payload"]["state"] == "detected"
        assert idle_event["payload"]["announce"] is False
        # visual status stays available
        assert h.client.get("/api/vision/status").json()["obstruction_active"] is True
        assert h.snapshot()["vision"]["obstruction_active"] is True
        assert h.snapshot()["journey"]["status"] == "idle"

        h.client.post("/api/dev/vision/clear")
        h.start()
        h.client.post("/api/dev/vision/obstruction")
        events = []
        while not any(e["type"] == "vision.obstacle" and e["payload"]["state"] == "detected" for e in events):
            events.append(ws.receive_json())
        started = [e for e in events if e["type"] == "vision.obstacle" and e["payload"]["state"] == "detected"][-1]
        assert started["payload"]["announce"] is True and started["payload"]["journey_paused"] is True

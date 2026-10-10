"""Sponsor providers with stubbed HTTP (no real API calls, no keys)."""

import json

from backend.app.sponsors import ElevenLabsSpeech, GeminiBriefing, validate_briefing
from backend.tests.conftest import Harness

FACTS = {
    "status": "dispatched",
    "location": {"source": "simulated", "landmark": "Fountain plaza"},
    "timeline": [{"event": "created", "at": "2026-10-10T01:58:44.422Z"}],
}
FACTS_TEXT = json.dumps(FACTS, indent=1)


def gemini_reply(summary: str):
    def post(url, headers, body, timeout):
        assert "x-goog-api-key" in headers
        return json.dumps({"candidates": [{"content": {"parts": [{"text": json.dumps({"summary": summary})}]}}]}).encode()

    return post


def test_validation_accepts_grounded_summary():
    ok = "A user on a simulated demo journey requested help near Fountain plaza (simulated location) at 01:58:44."
    assert validate_briefing(ok, FACTS_TEXT, "simulated") is None


def test_validation_rejects_unsafe_or_invented_output():
    assert "crime" in validate_briefing("Possible mugging near Fountain plaza, simulated location.", FACTS_TEXT, "simulated")
    assert "navigation" in validate_briefing("Simulated location. Turn left at the plaza.", FACTS_TEXT, "simulated")
    assert "simulated" in validate_briefing("Help requested near Fountain plaza.", FACTS_TEXT, "simulated")
    assert "number" in validate_briefing("Simulated location, 3 people nearby.", FACTS_TEXT, "simulated")
    assert validate_briefing(None, FACTS_TEXT, "simulated") == "missing summary"


def test_gemini_generate_ready_and_rejected():
    good = GeminiBriefing("k", "m", post=gemini_reply("Help requested near Fountain plaza (simulated location)."))
    assert good.generate(FACTS)["status"] == "ready"
    bad = GeminiBriefing("k", "m", post=gemini_reply("A robbery suspect is near Fountain plaza, simulated location."))
    assert bad.generate(FACTS)["status"] == "rejected"

    def boom(*a):
        raise TimeoutError()

    assert GeminiBriefing("k", "m", post=boom).generate(FACTS)["status"] == "failed"


def test_elevenlabs_caches_and_falls_back(tmp_path):
    calls = []

    def post(url, headers, body, timeout):
        calls.append(url)
        assert headers["xi-api-key"] == "secret"
        return b"ID3" + b"\0" * 200

    tts = ElevenLabsSpeech("secret", "voice", "model", tmp_path, post=post)
    a = tts.synthesize("Help request cancelled.")
    b = tts.synthesize("Help request cancelled.")
    assert a == b and len(calls) == 1  # second phrase served from cache
    assert tts.synthesize("x" * 301) is None

    def fail(*a):
        raise OSError("network down")

    assert ElevenLabsSpeech("secret", "voice", "model", tmp_path / "other", post=fail).synthesize("Hi") is None


def test_providers_off_without_keys(h):
    health = h.client.get("/api/health").json()
    assert health["speech_provider"] == "browser"
    assert health["briefing_provider"] == "deterministic"
    assert h.client.get("/api/speech", params={"text": "hello"}).status_code == 404
    assert "secret" not in json.dumps(health)


def test_ai_briefing_never_blocks_lifecycle(settings, clock):
    settings.gemini_api_key = "secret"
    h = Harness(settings, clock)
    try:
        h.svc.ai_briefing._post = gemini_reply("Help requested near North entrance (simulated location).")
        jid = h.start()
        iid = h.request_help(jid).json()["incident"]["id"]
        pending = h.client.get(f"/api/incidents/{iid}/briefing").json()
        assert pending["ai_status"] == "not_requested"  # not generated before dispatch
        h.tick(10)
        h.client.get(f"/api/incidents/{iid}/briefing")
        for _ in range(100):
            out = h.client.get(f"/api/incidents/{iid}/briefing").json()
            if out["ai_status"] == "ready":
                break
        assert out["provider"] == "gemini" and "simulated location" in out["text"]
        assert "Simulated location" in out["deterministic"]
        assert "secret" not in json.dumps(h.client.get("/api/health").json())
    finally:
        h.close()

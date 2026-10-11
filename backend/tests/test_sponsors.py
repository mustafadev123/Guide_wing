"""Sponsor providers with stubbed HTTP (no real API calls, no keys)."""

import json
import threading
import urllib.error

from backend.app.sponsors import ElevenLabsSpeech, GeminiBriefing, validate_briefing, incident_facts
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
        payload = json.loads(body)
        assert payload["generationConfig"]["responseFormat"]["text"]["schema"]["required"] == ["outcome", "timing"]
        assert "unknowns:" not in payload["contents"][0]["parts"][0]["text"]
        assert json.loads(body)["generationConfig"]["responseFormat"]["text"]["mimeType"] == "APPLICATION_JSON"
        return json.dumps({"candidates": [{"content": {"parts": [{"text": json.dumps({"outcome": summary,
            "timing": "This record captures a response sequence, not a service performance baseline."})}]}}]}).encode()

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


def wait_review(provider, incident_id):
    for _ in range(200):
        out = provider.result(incident_id)
        if out and out["status"] != "pending":
            return out
        threading.Event().wait(.01)
    raise AssertionError("Stub review did not complete")


def test_incident_review_receives_elapsed_times_without_identities_coordinates(h):
    jid=h.start(); iid=h.request_help(jid).json()["incident"]["id"]
    h.tick(49)
    h.client.post(f"/api/incidents/{iid}/accept",json={"responder":"private-name"})
    h.tick(9);h.client.post(f"/api/incidents/{iid}/resolve")
    facts=incident_facts(h.svc.incidents.detail(iid))
    assert facts["timings_seconds"]["dispatch_to_acceptance"] == 39
    assert facts["timings_seconds"]["acceptance_to_resolution"] == 9
    assert all(secret not in json.dumps(facts) for secret in (iid,"private-name","latitude","longitude","request_key"))
    good=GeminiBriefing("fake","model",post=gemini_reply("Simulated location. Acceptance took 39 seconds and resolution took 9 seconds."))
    assert good.generate(facts)["status"] == "ready"
    bad=GeminiBriefing("fake","model",post=gemini_reply("Simulated location. Acceptance took 999 seconds."))
    assert bad.generate(facts)["status"] == "rejected"


def test_changed_incident_facts_refresh_review_without_old_worker_overwriting():
    entered,release=threading.Event(),threading.Event()
    def post(url,headers,body,timeout):
        facts=json.loads(json.loads(body)["contents"][0]["parts"][0]["text"].rsplit("FACTS:\n",1)[-1])
        if facts['status']=='dispatched':entered.set();release.wait(2)
        return gemini_reply(f"Recorded state is {facts['status']} at a simulated location.")(url,headers,body,timeout)
    provider=GeminiBriefing('fake','model',post=post)
    try:
        provider.request_async('id',FACTS);assert entered.wait(1)
        provider.request_async('id',{**FACTS,'status':'resolved'})
        assert 'resolved' in wait_review(provider,'id')['text']
    finally:release.set()
    threading.Event().wait(.05)
    assert 'resolved' in provider.result('id')['text']


def test_review_failure_cooldown_and_explicit_read_retry():
    elapsed=[0.0];calls=[]
    def post(*args):calls.append(args);raise urllib.error.HTTPError('https://example.invalid',404,'secret',{},None)
    provider=GeminiBriefing('secret','model',post=post,monotonic=lambda:elapsed[0])
    provider.request_async('id',FACTS)
    out=wait_review(provider,'id')
    assert out['status']=='failed' and 'GEMINI_MODEL' in out['reason'] and 'secret' not in json.dumps(out)
    assert out['retry_after_s']==30
    provider.request_async('id',FACTS);assert len(calls)==1
    elapsed[0]=31;provider.request_async('id',FACTS)
    wait_review(provider,'id');assert len(calls)==2


def test_cancelled_history_can_generate_review(settings,clock):
    settings.gemini_api_key='fake';h=Harness(settings,clock)
    try:
        h.svc.ai_briefing._post=gemini_reply('The request was cancelled before dispatch at a simulated location.')
        iid=h.request_help(h.start()).json()['incident']['id']
        h.client.post(f'/api/incidents/{iid}/cancel')
        h.client.get(f'/api/incidents/{iid}/briefing')
        assert wait_review(h.svc.ai_briefing,iid)['status']=='ready'
        assert h.client.get(f'/api/incidents/{iid}/briefing').json()['ai_review']['timing']
    finally:h.close()


def test_incident_review_allows_slow_provider_and_reports_distinct_failures():
    def slow_success(url, headers, body, timeout):
        assert timeout == 45.0
        return gemini_reply("Recorded handoff at a simulated location.")(url, headers, body, timeout)
    assert GeminiBriefing("secret", "model", post=slow_success).generate(FACTS)["status"] == "ready"
    for error, expected in ((TimeoutError("secret"), "too long"),
                            (urllib.error.URLError(TimeoutError("secret")), "too long"),
                            (urllib.error.URLError("secret"), "Could not connect")):
        def fail(*args):
            raise error
        result = GeminiBriefing("secret", "model", post=fail).generate(FACTS)
        assert result["status"] == "failed" and expected in result["reason"]
        assert "secret" not in json.dumps(result)
    malformed = GeminiBriefing("secret", "model", post=lambda *args: b'{"candidates": []}').generate(FACTS)
    assert "incomplete or invalid response" in malformed["reason"]

"""Aggregate summaries with synthetic records and stubbed HTTP; no real keys."""

import json
import threading
import urllib.error
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from backend.app.analytics import AnalyticsSummaries, GeminiAnalytics, SummaryRequest, aggregate, analysis_context
from backend.app.services import Conflict, NotFound
from backend.tests.conftest import Harness


GOOD = "The simulated queue includes recorded help requests. Read the response timings alongside their sample sizes."


@pytest.fixture(autouse=True)
def no_retry_delay(monkeypatch):
    monkeypatch.setattr(AnalyticsSummaries, "TRANSIENT_RETRY_DELAY_S", 0.0)


@pytest.fixture(autouse=True)
def analytics_clock(clock):
    """Place the injected clock after this module's synthetic record timestamps."""
    clock.advance((datetime(2026, 10, 10, 12, tzinfo=timezone.utc) - clock.now()).total_seconds())


def row(**changes):
    values = dict(created_at="2026-10-10T01:00:00Z", status="resolved", is_test=False, request_source="gesture",
                  dispatched_at="2026-10-10T01:00:10Z", acknowledged_at="2026-10-10T01:00:40Z",
                  resolved_at="2026-10-10T01:02:40Z", id="private-id", responder="private-name",
                  request_key="private-key", location={"landmark": "private-place", "latitude": 33.0})
    return SimpleNamespace(**(values | changes))


def reply(summary=GOOD):
    return json.dumps({"candidates": [{"content": {"parts": [
        {"text": "hidden reasoning", "thought": True}, {"text": json.dumps({"overview": summary,
          "response_times": "Timing figures describe the recorded responses, not an established service baseline.",
          "next_check": "Review the acceptance step during the next rehearsal."})},
    ]}}]}).encode()


def finished(manager, key):
    event = threading.Event()
    for _ in range(200):
        out = manager.get(key)
        if out.status != "pending":
            return out
        event.wait(0.01)
    pytest.fail("Stub summary did not finish")


def test_aggregate_filters_and_timing_anchors(clock):
    rows = [row(), row(is_test=True), row(created_at="2026-10-08T01:00:00Z"),
            row(created_at="2026-10-11T01:00:00Z"), row(created_at="invalid"),
            row(status="cancelled", dispatched_at=None, acknowledged_at=None, resolved_at=None)]
    out = aggregate(rows, SummaryRequest(), clock.now())
    assert out.total == 2 and out.counts["resolved"] == 1 and out.counts["cancelled"] == 1
    assert out.accepted_seconds == 30 and out.accepted_sample == 1
    assert out.resolved_seconds == 120 and out.resolved_sample == 1
    assert aggregate(rows, SummaryRequest(range="week", include_tests=True), clock.now()).total == 4
    assert aggregate([row(acknowledged_at="2026-10-09T01:00:00Z", resolved_at=None)], SummaryRequest(), clock.now()).accepted_seconds is None


def test_empty_and_unconfigured_do_not_call_provider(clock):
    calls = []
    provider = GeminiAnalytics("fake", "model", post=lambda *args: calls.append(args) or reply())
    assert AnalyticsSummaries(lambda: [], clock, provider).request(SummaryRequest()).status == "empty"
    assert AnalyticsSummaries(lambda: [row()], clock, None).request(SummaryRequest()).status == "not_configured"
    assert calls == []


def test_provider_receives_only_aggregates_and_cache_is_stable(clock):
    calls = []
    def post(url, headers, body, timeout):
        calls.append(json.loads(body))
        assert headers["x-goog-api-key"] == "fake"
        assert timeout == 40
        assert json.loads(body)["generationConfig"]["responseFormat"]["text"]["mimeType"] == "APPLICATION_JSON"
        return reply()
    provider = GeminiAnalytics("fake", "model", post=post)
    manager = AnalyticsSummaries(lambda: [row()], clock, provider)
    first = manager.request(SummaryRequest())
    out = finished(manager, first.job_id)
    assert out.status == "ready" and out.sections.overview == GOOD and GOOD in out.text
    clock.advance(2)
    repeated = manager.request(SummaryRequest())
    assert repeated.cached and repeated.as_of == first.as_of and len(calls) == 1
    sent = json.dumps(calls)
    assert all(secret not in sent for secret in ("private-id", "private-name", "private-key", "private-place", "latitude", "snapshot"))
    assert "fake" not in out.model_dump_json()


def test_changed_selection_and_metrics_require_explicit_generation(clock):
    rows = [row()]; calls = []
    manager = AnalyticsSummaries(lambda: rows, clock, GeminiAnalytics("fake", "model", post=lambda *a: calls.append(a) or reply()))
    first = manager.request(SummaryRequest()); finished(manager, first.job_id)
    rows.append(row(status="pending", acknowledged_at=None, resolved_at=None))
    assert manager.get(first.job_id).metrics.total == 1 and len(calls) == 1
    second = manager.request(SummaryRequest()); finished(manager, second.job_id)
    third = manager.request(SummaryRequest(include_tests=True)); finished(manager, third.job_id)
    assert len(calls) == 3 and first.job_id != second.job_id != third.job_id


def test_pending_requests_deduplicate_and_do_not_block(clock):
    entered, release = threading.Event(), threading.Event()
    calls = []
    def post(*args):
        calls.append(args); entered.set(); release.wait(2); return reply()
    manager = AnalyticsSummaries(lambda: [row()], clock, GeminiAnalytics("fake", "model", post=post))
    try:
        first = manager.request(SummaryRequest()); assert entered.wait(1)
        second = manager.request(SummaryRequest())
        assert second.status == "pending" and second.cached and len(calls) == 1
        manager.request(SummaryRequest(range="week"))
        with pytest.raises(Conflict): manager.request(SummaryRequest(range="loaded"))
    finally: release.set()
    assert finished(manager, first.job_id).status == "ready"


@pytest.mark.parametrize("summary", ["A real emergency response was delivered.", "Simulated queue has 900 requests.", "Simulated location. Turn left.", "Simulated robbery detected.", None])
def test_rejected_output_is_not_published(summary):
    out = GeminiAnalytics("fake", "model", post=lambda *a: reply(summary)).generate({"metrics": {"total": 1}})
    assert out["status"] == "rejected" and "text" not in out


@pytest.mark.parametrize("code,phrase", [(400, "HTTP 400"), (401, "API key"), (403, "permissions"), (404, "model"), (429, "quota")])
def test_provider_errors_are_actionable_and_never_expose_keys(code, phrase):
    def post(*a): raise urllib.error.HTTPError("https://example.invalid", code, "secret-key", {}, None)
    result = GeminiAnalytics("secret-key", "model", post=post).generate({})
    assert result["status"] == "failed" and phrase in result["reason"] and "secret-key" not in str(result)


def test_timeout_and_parse_errors_keep_metrics(clock):
    def post(*a): raise TimeoutError("secret-key")
    manager = AnalyticsSummaries(lambda: [row()], clock, GeminiAnalytics("secret-key", "model", post=post))
    out = finished(manager, manager.request(SummaryRequest()).job_id)
    assert out.status == "failed" and out.metrics.total == 1 and out.retry_after_s > 0
    assert "secret-key" not in out.model_dump_json()
    assert GeminiAnalytics("fake", "model", post=lambda *a: b"bad JSON").generate({})["status"] == "failed"


def test_failure_retry_cooldown_and_ready_expiry(clock):
    calls = []; elapsed = [0.0]
    def post(*a): calls.append(a); return reply()
    manager = AnalyticsSummaries(lambda: [row()], clock, GeminiAnalytics("fake", "model", post=post), monotonic=lambda: elapsed[0])
    first = manager.request(SummaryRequest()); finished(manager, first.job_id)
    elapsed[0] = 901
    assert not manager.request(SummaryRequest()).cached
    finished(manager, first.job_id)
    assert len(calls) == 2
    def fail(*a): calls.append(a); raise TimeoutError()
    manager.provider._post = fail
    elapsed[0] += 901
    finished(manager, manager.request(SummaryRequest()).job_id)
    manager.request(SummaryRequest())
    assert len(calls) == 4  # timeout -> one quiet retry, then cooldown (no new call)
    elapsed[0] += 31
    finished(manager, manager.request(SummaryRequest()).job_id)
    assert len(calls) == 6


def test_api_off_and_unknown_jobs_do_not_leak_configuration(h):
    assert h.client.get("/api/analytics/config").json()["configured"] is False
    assert h.client.post("/api/analytics/summary", json={"range": "day"}).json()["status"] == "not_configured"
    assert h.client.post("/api/analytics/summary", json={"range": "invalid"}).status_code == 422
    assert h.client.post("/api/analytics/summary", json={"records": []}).status_code == 422
    assert h.client.get("/api/analytics/summary/unknown").status_code == 404


def test_summary_job_does_not_change_help_or_journey_lifecycle(settings, clock):
    settings.gemini_api_key = "fake"
    h = Harness(settings, clock)
    entered, release = threading.Event(), threading.Event()
    def post(*a): entered.set(); release.wait(2); return reply()
    h.svc.analytics.provider._post = post
    try:
        jid = h.start(); incident = h.request_help(jid).json()["incident"]
        response = h.client.post("/api/analytics/summary", json={"range": "day"}).json()
        assert response["status"] == "pending" and entered.wait(1)
        assert h.client.post(f"/api/incidents/{incident['id']}/cancel").status_code == 200
        assert h.snapshot()["journey"]["status"] == "paused"
        assert h.client.get("/api/analytics/config").json()["configured"] is True
        release.set(); assert finished(h.svc.analytics, response["job_id"]).status == "ready"
    finally:
        release.set(); h.close()


def test_cache_has_bounded_entries_and_unknown_job_is_explicit(clock):
    rows = [row()]
    manager = AnalyticsSummaries(lambda: rows, clock, GeminiAnalytics("fake", "model", post=lambda *a: reply()))
    manager.MAX_ENTRIES = 2
    first = manager.request(SummaryRequest()); finished(manager, first.job_id)
    second = manager.request(SummaryRequest(range="week")); finished(manager, second.job_id)
    third = manager.request(SummaryRequest(range="loaded")); finished(manager, third.job_id)
    with pytest.raises(NotFound): manager.get(first.job_id)


def test_interpretation_facts_use_recorded_sources_cancel_stage_and_timing_distribution(clock):
    rows = [row(), row(request_source="button", acknowledged_at="2026-10-10T01:09:40Z"),
            row(status="cancelled", dispatched_at=None, acknowledged_at=None, resolved_at=None),
            row(status="cancelled", request_source="button", acknowledged_at=None, resolved_at=None),
            row(is_test=True)]
    selection = SummaryRequest()
    metrics = aggregate(rows, selection, clock.now())
    context = analysis_context(rows, selection, clock.now(), metrics)
    assert context["request_sources"] == {"button": 2, "gesture": 2, "imessage": 0, "voice": 0, "test": 0}
    assert context["cancelled_before_dispatch"] == context["cancelled_after_dispatch"] == 1
    assert context["resolved_share_percent"] == context["cancelled_share_percent"] == 50
    assert context["open_requests"] == 0
    assert context["acceptance"]["mean_seconds"] == 300
    assert context["acceptance"]["median_seconds"] == 300
    assert context["acceptance"]["slowest_minutes"] == 9.5
    assert context["resolution"]["sample"] == 1  # second resolution predates acceptance



def test_voice_requests_are_counted_as_an_input_method(clock):
    from backend.app.analytics import instant_sections
    rows = [row(request_source="voice"), row(request_source="voice"), row()]
    selection = SummaryRequest()
    metrics = aggregate(rows, selection, clock.now())
    context = analysis_context(rows, selection, clock.now(), metrics)
    assert context["request_sources"]["voice"] == 2
    overview = instant_sections({"metrics": metrics.model_dump(), "analysis": context}).overview
    assert "2 voice commands" in overview and "1 open-palm gesture" in overview

def test_numeric_report_accepts_only_numbers_present_in_server_facts():
    out = GeminiAnalytics("fake", "model", post=lambda *a: reply(
        "This simulated queue has 4 requests, with 2 resolved and 50% cancelled.")).generate(
            {"metrics": {"total": 4}, "analysis": {"resolved": 2, "cancelled_share_percent": 50.0}})
    assert out["status"] == "ready" and out["sections"].overview.startswith("This simulated")
    rejected = GeminiAnalytics("fake", "model", post=lambda *a: reply(
        "This simulated queue has 4 requests with 99% resolved.")).generate({"metrics": {"total": 4}})
    assert rejected["status"] == "rejected"
    for invented in ("1,000", "1e6"):
        result = GeminiAnalytics("fake", "model", post=lambda *a: reply(
            f"This simulated queue has {invented} requests.")).generate({"metrics": {"total": 1, "pending": 0}})
        assert result["status"] == "rejected"


def test_empty_interpretation_has_no_invented_durations_or_rates(clock):
    selection = SummaryRequest()
    out = analysis_context([], selection, clock.now(), aggregate([], selection, clock.now()))
    assert out["resolved_share_percent"] is None and out["open_requests"] == 0
    assert all(out["acceptance"][name] is None for name in ("mean_seconds", "median_seconds", "slowest_minutes"))


def test_interpretation_change_invalidates_cache_when_primary_counts_and_means_match(clock):
    rows = [row()]
    calls = []
    manager = AnalyticsSummaries(lambda: rows, clock, GeminiAnalytics("fake", "model", post=lambda *a: calls.append(a) or reply()))
    first = manager.request(SummaryRequest()); finished(manager, first.job_id)
    rows[0].request_source = "button"
    second = manager.request(SummaryRequest()); finished(manager, second.job_id)
    assert first.metrics == second.metrics and first.job_id != second.job_id and len(calls) == 2


def test_instant_summary_is_always_available_and_uses_recorded_figures(clock):
    rows = [row(),  # dispatched 01:00:10, accepted 01:00:40 (30 s), resolved 01:02:40 (120 s)
            row(status="cancelled", dispatched_at=None, acknowledged_at=None, resolved_at=None, request_source="button")]
    def post(*a): raise TimeoutError()
    manager = AnalyticsSummaries(lambda: rows, clock, GeminiAnalytics("fake", "model", post=post))
    pending = manager.request(SummaryRequest())
    assert pending.status == "pending" and pending.instant_sections is not None  # shown immediately
    failed = finished(manager, pending.job_id)
    assert failed.status == "failed" and failed.instant_sections == pending.instant_sections  # still there after failure
    text = failed.instant_sections.overview + " " + failed.instant_sections.response_times
    assert "2 simulated requests" in text and "1 resolved (50%)" in text and "1 cancelled (50%)" in text
    assert "no requests still open" in text and "1 happened before dispatch" in text
    assert "1 open-palm gesture and 1 Help button press" in text
    assert "30 seconds for the one recorded response" in text and "120 seconds (about 2 minutes)" in text
    unconfigured = AnalyticsSummaries(lambda: rows, clock, None).request(SummaryRequest())
    assert unconfigured.status == "not_configured" and unconfigured.instant_sections is not None
    assert AnalyticsSummaries(lambda: [], clock, None).request(SummaryRequest()).instant_sections is None


def test_transient_failure_is_retried_once_quietly(clock):
    calls = []
    def flaky(*a):
        calls.append(a)
        if len(calls) == 1:
            raise urllib.error.HTTPError("https://example.invalid", 503, "busy", {}, None)
        return reply()
    manager = AnalyticsSummaries(lambda: [row()], clock, GeminiAnalytics("fake", "model", post=flaky))
    out = finished(manager, manager.request(SummaryRequest()).job_id)
    assert out.status == "ready" and len(calls) == 2


def test_non_transient_failure_is_not_retried(clock):
    calls = []
    def denied(*a):
        calls.append(a); raise urllib.error.HTTPError("https://example.invalid", 401, "no", {}, None)
    manager = AnalyticsSummaries(lambda: [row()], clock, GeminiAnalytics("fake", "model", post=denied))
    out = finished(manager, manager.request(SummaryRequest()).job_id)
    assert out.status == "failed" and len(calls) == 1 and out.instant_sections is not None

"""Read-only aggregate analytics and explicit, cached Gemini summary jobs.

Only whitelisted aggregate facts cross the provider boundary. Request/journey
transitions remain in services.py. Summary jobs and their cache are process-local.
"""

import hashlib
import json
import logging
import math
import re
import threading
import time
import urllib.error
from decimal import Decimal
from statistics import median
from collections import OrderedDict
from datetime import datetime, timedelta, timezone
from typing import Callable, Literal

from pydantic import BaseModel, ConfigDict

from .clock import utc_iso
from .schemas import Incident
from .services import Conflict, NotFound
from .sponsors import FORBIDDEN, PostFn, http_post

log = logging.getLogger("guidewing.analytics")
Range = Literal["day", "week", "loaded"]
LIMIT = 500
STATUSES = ("pending", "dispatched", "acknowledged", "resolved", "cancelled")


class SummaryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    range: Range = "day"
    include_tests: bool = False


class AggregateFacts(BaseModel):
    total: int
    counts: dict[str, int]
    accepted_seconds: float | None
    accepted_sample: int
    resolved_seconds: float | None
    resolved_sample: int


class ReportSections(BaseModel):
    overview: str
    response_times: str
    next_check: str


class SummaryResult(BaseModel):
    job_id: str
    status: Literal["pending", "ready", "not_configured", "empty", "failed", "rejected"]
    provider: Literal["gemini", "unavailable"]
    model: str | None
    range: Range
    include_tests: bool
    as_of: str
    from_at: str | None
    scope: str = "Latest 500 stored requests, filtered by creation time"
    metrics: AggregateFacts
    text: str | None = None
    sections: ReportSections | None = None
    reason: str | None = None
    cached: bool = False
    retry_after_s: int = 0


def _date(value: str | None) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(value) if value else None
        return parsed.astimezone(timezone.utc) if parsed and parsed.tzinfo else None
    except (ValueError, TypeError):
        return None


def aggregate(incidents: list[Incident], selection: SummaryRequest, now: datetime) -> AggregateFacts:
    start = now - timedelta(hours=24 if selection.range == "day" else 168) if selection.range != "loaded" else None
    selected = [i for i in incidents if (selection.include_tests or not i.is_test)
                and (created := _date(i.created_at)) is not None and created <= now
                and (start is None or created >= start)]

    def durations(first: str, last: str) -> list[float]:
        result = []
        for incident in selected:
            begin, end = _date(getattr(incident, first)), _date(getattr(incident, last))
            if begin and end:
                seconds = (end - begin).total_seconds()
                if math.isfinite(seconds) and seconds >= 0:
                    result.append(seconds)
        return result

    acceptance = durations("dispatched_at", "acknowledged_at")
    resolution = durations("acknowledged_at", "resolved_at")
    return AggregateFacts(
        total=len(selected), counts={status: sum(i.status == status for i in selected) for status in STATUSES},
        accepted_seconds=round(sum(acceptance) / len(acceptance), 1) if acceptance else None,
        accepted_sample=len(acceptance),
        resolved_seconds=round(sum(resolution) / len(resolution), 1) if resolution else None,
        resolved_sample=len(resolution),
    )


def analysis_context(incidents: list[Incident], selection: SummaryRequest, now: datetime,
                     metrics: AggregateFacts) -> dict:
    """Additional anonymous facts for interpretation, never AI-computed arithmetic."""
    start = now - timedelta(hours=24 if selection.range == "day" else 168) if selection.range != "loaded" else None
    selected = [i for i in incidents if (selection.include_tests or not i.is_test)
                and (created := _date(i.created_at)) is not None and created <= now
                and (start is None or created >= start)]

    def timing(first: str, last: str, average: float | None) -> dict:
        samples = []
        for incident in selected:
            begin, end = _date(getattr(incident, first)), _date(getattr(incident, last))
            if begin and end and (seconds := (end - begin).total_seconds()) >= 0 and math.isfinite(seconds):
                samples.append(seconds)
        middle = round(median(samples), 1) if samples else None
        longest = round(max(samples), 1) if samples else None
        return {"sample": len(samples), "mean_seconds": average,
                "mean_minutes": round(average / 60, 1) if average is not None else None,
                "median_seconds": middle, "median_minutes": round(middle / 60, 1) if middle is not None else None,
                "slowest_seconds": longest, "slowest_minutes": round(longest / 60, 1) if longest is not None else None}

    cancelled = [i for i in selected if i.status == "cancelled"]
    return {
        "open_requests": sum(metrics.counts[s] for s in ("pending", "dispatched", "acknowledged")),
        "resolved_share_percent": round(metrics.counts["resolved"] / metrics.total * 100, 1) if metrics.total else None,
        "cancelled_share_percent": round(len(cancelled) / metrics.total * 100, 1) if metrics.total else None,
        "cancelled_before_dispatch": sum(not i.dispatched_at for i in cancelled),
        "cancelled_after_dispatch": sum(bool(i.dispatched_at) for i in cancelled),
        "request_sources": {source: sum(i.request_source == source for i in selected) for source in ("button", "gesture", "test")},
        "acceptance": timing("dispatched_at", "acknowledged_at", metrics.accepted_seconds),
        "resolution": timing("acknowledged_at", "resolved_at", metrics.resolved_seconds),
        "window_hours": 24 if selection.range == "day" else 168 if selection.range == "week" else None,
        "rehearsal_focus": (
            "Review the dispatch-to-acceptance step: rehearse noticing a dispatched request and accepting it, then compare the recorded interval."
            if metrics.accepted_seconds is not None and (metrics.resolved_seconds is None or metrics.accepted_seconds >= metrics.resolved_seconds)
            else "Review acceptance-to-resolution: rehearse completing a response and recording resolution, then compare the recorded interval."
            if metrics.resolved_seconds is not None
            else "Rehearse cancellation before and after dispatch and record the stage; cancellation reasons are not captured."
            if cancelled
            else "Complete a dispatch, acceptance and resolution rehearsal so each response stage has recorded timing samples."
        ),
    }


class GeminiAnalytics:
    """Small text-only provider using the existing server-side HTTP transport."""

    def __init__(self, key: str, model: str, post: PostFn = http_post):
        self._key, self.model, self._post = key, model, post

    def generate(self, facts: dict) -> dict:
        prompt = (
            "You are reviewing Guide Wing's simulated help-request workflow for a hackathon rehearsal. "
            "Write a useful report, under 180 words across three fields, using ONLY the supplied facts. "
            "overview: at most two sentences. Lead with concrete total, resolved/cancelled counts or provided percentages, and "
            "whether any requests remain open. Say 'simulated' once. Mention before/after-dispatch "
            "cancellations or gesture/button usage when informative. Do not recite every zero status. "
            "response_times: at most two sentences. State the actual dispatch-to-acceptance average and qualifying sample size, "
            "then acceptance-to-resolution timing. Prefer provided minute values for long waits. "
            "Do not repeat the median when it equals the mean. Mention the slowest only if it adds a "
            "clear contrast; do not list every timing statistic. Use natural English, not field-name narration. "
            "For one timing sample, clearly say it is one recorded response, not a typical service time. "
            "Missing averages mean unavailable, not instant. "
            "next_check: one plain-language sentence about the supplied rehearsal_focus, "
            "linked to the recorded figures. Never compare cancellation timing with acceptance timing: "
            "cancelled requests have no completed acceptance interval. Frame it as a check, never a cause "
            "or a proven improvement. No numerical targets, benchmarks, forecasts or invented trends. "
            "Use numeric values exactly as provided; do not calculate, round again, or spell numbers "
            "out as words. Do not infer why a user cancelled or why a responder waited. Do not claim "
            "safety, urgency, real dispatch/service quality, identities, or global totals. No navigation "
            "or emergency instructions. Scope and TEST filters are already labeled by the interface; "
            "do not waste the report repeating boilerplate or vague 'samples are limited' alone.\n"
            + json.dumps(facts, sort_keys=True)
        )
        body = json.dumps({
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": 0.1,
                "responseFormat": {"text": {"mimeType": "APPLICATION_JSON", "schema": {
                    "type": "object", "properties": {
                        field: {"type": "string"} for field in ("overview", "response_times", "next_check")},
                    "required": ["overview", "response_times", "next_check"], "additionalProperties": False,
                }}},
            },
        }).encode()
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent"
        try:
            raw = self._post(url, {"x-goog-api-key": self._key, "Content-Type": "application/json"}, body, 15.0)
            response = json.loads(raw)
            parts = response["candidates"][0]["content"]["parts"]
            text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
            parsed = json.loads(text)
            values = [parsed.get(field) for field in ("overview", "response_times", "next_check")]
        except urllib.error.HTTPError as exc:
            log.warning("Analytics summary HTTP error (%s)", exc.code)
            reason = {400: "Gemini rejected the summary request (HTTP 400). Check the model/API configuration or update the integration.",
                      401: "Gemini rejected the API key. Check GEMINI_API_KEY and restart the backend.",
                      403: "Gemini API access was denied. Check this key's project and API permissions.",
                      404: "Gemini model unavailable. Check GEMINI_ANALYTICS_MODEL for this account.",
                      429: "Gemini quota or rate limit reached. Check Google AI Studio quota and retry later."}.get(
                          exc.code, f"Gemini service error (HTTP {exc.code}). Retry later.")
            return {"status": "failed", "reason": reason}
        except Exception as exc:  # no exception text, request bodies, or keys in logs
            log.warning("Analytics summary failed (%s)", type(exc).__name__)
            return {"status": "failed", "reason": "Gemini did not return a usable response. Check connectivity and retry."}
        if any(not isinstance(value, str) or not value.strip() or len(value) > 800 for value in values):
            return {"status": "rejected", "reason": "The AI response did not match the required report sections."}
        summary = "\n\n".join(value.strip() for value in values)
        numbers = re.compile(r"(?<![\w.])[-+]?\d+(?:,\d{3})*(?:\.\d+)?(?:[eE][-+]?\d+)?")
        allowed = {Decimal(n.replace(",", "")) for n in numbers.findall(json.dumps(facts))}
        if (len(summary) > 1800 or "simulated" not in summary.lower() or FORBIDDEN.search(summary)
                or any(Decimal(n.replace(",", "")) not in allowed for n in numbers.findall(summary))):
            return {"status": "rejected", "reason": "The AI response failed grounding checks. Recorded metrics remain available."}
        sections = ReportSections(**dict(zip(("overview", "response_times", "next_check"), (v.strip() for v in values))))
        return {"status": "ready", "text": summary, "sections": sections}


class AnalyticsSummaries:
    CACHE_SECONDS = 900
    RETRY_SECONDS = 30
    MAX_ENTRIES = 64
    MAX_PENDING = 2

    def __init__(self, fetch: Callable[[], list[Incident]], clock, provider: GeminiAnalytics | None,
                 monotonic: Callable[[], float] = time.monotonic):
        self._fetch, self._clock, self.provider, self._time = fetch, clock, provider, monotonic
        self._jobs: OrderedDict[str, tuple[SummaryResult, float]] = OrderedDict()
        self._lock = threading.Lock()

    def configuration(self) -> dict:
        return {"configured": self.provider is not None, "provider": "gemini" if self.provider else None,
                "model": self.provider.model if self.provider else None, "record_limit": LIMIT}

    def request(self, selection: SummaryRequest) -> SummaryResult:
        now = self._clock.now()
        incidents = self._fetch()
        metrics = aggregate(incidents, selection, now)
        # Timestamps drift while polling; cache by unchanged selected aggregate facts.
        facts = {"range": selection.range, "include_tests": selection.include_tests,
                 "record_limit": LIMIT, "metrics": metrics.model_dump(),
                 "analysis": analysis_context(incidents, selection, now, metrics)}
        identity = {"prompt_version": 2, "model": self.provider.model if self.provider else None, **facts}
        key = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
        from_at = utc_iso(now - timedelta(hours=24 if selection.range == "day" else 168)) if selection.range != "loaded" else None
        out = SummaryResult(job_id=key, status="pending", provider="gemini" if self.provider else "unavailable",
                            model=self.provider.model if self.provider else None, range=selection.range,
                            include_tests=selection.include_tests, as_of=utc_iso(now), from_at=from_at, metrics=metrics)
        if not self.provider:
            return out.model_copy(update={"status": "not_configured", "reason": "Set GEMINI_API_KEY in Guide_wing/.env and restart the backend."})
        if not metrics.total:
            return out.model_copy(update={"status": "empty", "reason": "No requests in this selection. No Gemini request was made."})
        with self._lock:
            previous = self._jobs.get(key)
            if previous:
                result, at = previous
                ttl = self.RETRY_SECONDS if result.status in ("failed", "rejected") else self.CACHE_SECONDS
                if result.status == "pending" or self._time() - at < ttl:
                    self._jobs.move_to_end(key)
                    return self._copy(result, at, cached=True)
            if sum(job.status == "pending" for job, _ in self._jobs.values()) >= self.MAX_PENDING:
                raise Conflict("Other analytics summaries are generating. Please retry shortly.")
            while len(self._jobs) >= self.MAX_ENTRIES:
                old = next((k for k, (job, _) in self._jobs.items() if job.status != "pending"), None)
                if old is None:
                    raise Conflict("Analytics summary queue is busy. Please retry shortly.")
                del self._jobs[old]
            self._jobs[key] = (out, self._time())
        threading.Thread(target=self._run, args=(key, facts), name="analytics-summary", daemon=True).start()
        return out.model_copy()

    def _copy(self, result: SummaryResult, at: float, cached: bool = False) -> SummaryResult:
        retry = max(0, math.ceil(self.RETRY_SECONDS - (self._time() - at))) if result.status in ("failed", "rejected") else 0
        return result.model_copy(update={"cached": cached, "retry_after_s": retry}, deep=True)

    def get(self, key: str) -> SummaryResult:
        with self._lock:
            if key not in self._jobs:
                raise NotFound("Summary unavailable after restart or cache eviction. Generate it again explicitly.")
            result, at = self._jobs[key]
            return self._copy(result, at)

    def _run(self, key: str, facts: dict) -> None:
        try:
            value = self.provider.generate(facts)  # type: ignore[union-attr]
        except Exception:
            value = {"status": "failed", "reason": "Summary provider unavailable. Retry later."}
        with self._lock:
            current, _ = self._jobs[key]
            self._jobs[key] = (current.model_copy(update=value), self._time())

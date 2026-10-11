"""Optional sponsor providers. Off unless an API key is set; failures fall back silently.

ElevenLabsSpeech  server-side text-to-speech with an on-disk cache of common phrases.
                  The user browser plays the audio; it falls back to browser speech.
GeminiBriefing    asynchronous responder briefing built ONLY from recorded incident
                  facts and timeline. Output is schema- and content-validated; the
                  deterministic briefing is always available and used on any failure.

Neither provider is in the request/cancel/accept path, so provider failure can never
delay the lifecycle. Keys stay server-side and are never logged or returned.
"""

import hashlib
import json
import math
import logging
import re
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Callable
from datetime import datetime
from decimal import Decimal

log = logging.getLogger("guidewing.sponsors")

PostFn = Callable[[str, dict, bytes, float], bytes]  # (url, headers, body, timeout) -> response body


def http_post(url: str, headers: dict, body: bytes, timeout: float) -> bytes:
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


class ElevenLabsSpeech:
    name = "elevenlabs"
    MAX_CHARS = 300

    def __init__(self, api_key: str, voice_id: str, model_id: str, cache_dir: Path, post: PostFn = http_post):
        self._key = api_key
        self.voice_id = voice_id
        self.model_id = model_id
        self.cache_dir = cache_dir
        self._post = post
        self._lock = threading.Lock()

    def synthesize(self, text: str) -> bytes | None:
        text = text.strip()
        if not text or len(text) > self.MAX_CHARS:
            return None
        digest = hashlib.sha256(f"{self.voice_id}|{self.model_id}|{text}".encode()).hexdigest()[:32]
        path = self.cache_dir / f"{digest}.mp3"
        if path.exists():
            return path.read_bytes()
        url = f"https://api.elevenlabs.io/v1/text-to-speech/{self.voice_id}?output_format=mp3_44100_128"
        body = json.dumps({"text": text, "model_id": self.model_id}).encode()
        try:
            audio = self._post(url, {"xi-api-key": self._key, "Content-Type": "application/json",
                                     "Accept": "audio/mpeg"}, body, 8.0)
        except Exception as e:  # noqa: BLE001 - fall back to browser speech
            log.warning("ElevenLabs request failed (%s); browser speech will be used", type(e).__name__)
            return None
        if not audio or len(audio) < 100:
            return None
        with self._lock:
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            path.write_bytes(audio)
        return audio


# ---- Gemini briefing ------------------------------------------------------------

FORBIDDEN = re.compile(
    r"\b(mugg\w*|robber\w*|robbed|assault\w*|attack\w*|crim\w*|suspect\w*|thie\w*|weapon\w*|police|"
    r"turn (left|right)|go straight|head (north|south|east|west)|walk (to|toward)|navigate\w*|"
    r"route (to|via)|send (an? )?(officer|unit|ambulance))\b",
    re.IGNORECASE,
)
NUMBER = re.compile(r"\d+(?:[.:]\d+)*")


def validate_briefing(summary: object, facts_text: str, location_source: str) -> str | None:
    """Return a reason string if the AI summary is unacceptable, else None."""
    if not isinstance(summary, str) or not summary.strip():
        return "missing summary"
    if len(summary) > 1500:
        return "too long"
    if FORBIDDEN.search(summary):
        return "contains crime classification, navigation or dispatch-control language"
    if location_source == "simulated" and "simulated" not in summary.lower():
        return "dropped the simulated-location label"
    numeric = re.compile(r"(?<![\w.])[-+]?\d+(?:,\d{3})*(?:\.\d+)?(?:[eE][-+]?\d+)?")
    allowed = {Decimal(n.replace(",", "")) for n in numeric.findall(facts_text)}
    numeric_summary = NUMBER.sub(lambda m: "" if ":" in m.group() and m.group() in facts_text else m.group(), summary)
    for n in numeric.findall(numeric_summary):
        if Decimal(n.replace(",", "")) not in allowed:
            return f"number {n!r} not present in recorded facts"
    return None


class GeminiBriefing:
    name = "gemini"

    def __init__(self, api_key: str, model: str, post: PostFn = http_post, monotonic=time.monotonic):
        self._key = api_key
        self.model = model
        self._post = post
        self._results: dict[str, dict] = {}
        self._keys: dict[str, str] = {}
        self._completed: dict[str, float] = {}
        self._time = monotonic
        self._lock = threading.Lock()

    def result(self, incident_id: str) -> dict | None:
        with self._lock:
            result = self._results.get(incident_id)
            if result is None:
                return None
            remaining = max(0, math.ceil(30 - (self._time() - self._completed.get(incident_id, self._time())))) if result["status"] in ("failed", "rejected") else 0
            return {**result, "retry_after_s": remaining}

    def request_async(self, incident_id: str, facts: dict) -> None:
        key = hashlib.sha256(json.dumps({"prompt_version": 3, "model": self.model, "facts": facts}, sort_keys=True).encode()).hexdigest()
        with self._lock:
            previous = self._results.get(incident_id)
            if self._keys.get(incident_id) == key and previous:
                if previous["status"] in ("pending", "ready") or self._time() - self._completed.get(incident_id, 0) < 30:
                    return
            self._keys[incident_id] = key
            self._results[incident_id] = {"status": "pending"}
        threading.Thread(target=self._run, args=(incident_id, key, facts), daemon=True).start()

    def _run(self, incident_id: str, key: str, facts: dict) -> None:
        try:
            result = self.generate(facts)
        except Exception:
            result = {"status": "failed", "reason": "Gemini review unavailable. Retry later."}
        self._store(incident_id, result, key)

    def _store(self, incident_id: str, value: dict, key: str | None = None) -> None:
        with self._lock:
            if key is not None and self._keys.get(incident_id) != key:
                return  # a later acceptance/resolution already requested newer facts
            self._results[incident_id] = value
            self._completed[incident_id] = self._time()

    def generate(self, facts: dict) -> dict:
        facts_text = json.dumps(facts, indent=1)
        prompt = (
            "Write a concise retrospective review of a Guide Wing simulated help request, using ONLY these facts. "
            "The reader already sees the status, location and timestamps: do not re-list them or paraphrase every field. "
            "Return two short sections, under 100 words total. "
            "outcome: explain what the recorded sequence establishes about the handoff and current outcome. "
            "Resolved means the responder marked it resolved, not independently verified assistance. "
            "timing: use the server-computed elapsed seconds to compare stages, explaining where the recorded "
            "interval was concentrated. When both are available, compare dispatch-to-acceptance with "
            "acceptance-to-resolution, rather than the initial cancellation window. Use natural phrases "
            "like 'waiting for acceptance', never JSON field names. Cite at most two durations exactly as supplied; never calculate new "
            "numbers or benchmarks. Do not claim typical performance from one incident. Missing durations are unavailable, not zero; "
            "mention a missing stage only when relevant, not as generic boilerplate. "
            "Do not guess causes, intent, hazards, safety or responder competence. Do not infer images from the snapshot flag: "
            "no image is supplied. No crime classification, navigation or dispatch instructions. "
            "Mention 'simulated location' if the location source is simulated. Avoid raw coordinates, clock timestamps "
            "and identities; they are already displayed. Use digits for any measured duration, not spelled-out numbers.\n\n"
            f"FACTS:\n{facts_text}"
        )
        body = json.dumps({
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": 0.1,
                "responseFormat": {"text": {"mimeType": "APPLICATION_JSON", "schema": {
                    "type": "object", "properties": {key: {"type": "string"} for key in ("outcome", "timing")},
                    "required": ["outcome", "timing"], "additionalProperties": False,
                }}},
            },
        }).encode()
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent"
        try:
            raw = self._post(url, {"x-goog-api-key": self._key, "Content-Type": "application/json"}, body, 45.0)
            data = json.loads(raw)
            text = "".join(p.get("text", "") for p in data["candidates"][0]["content"]["parts"] if not p.get("thought"))
            review = json.loads(text)
            if any(not isinstance(review.get(k), str) or not review[k].strip() or len(review[k]) > 600 for k in ("outcome", "timing")):
                return {"status": "rejected", "reason": "Gemini returned incomplete review sections. Recorded facts remain available."}
            review = {k: review[k].strip() for k in ("outcome", "timing")}
            summary = "\n\n".join(review.values())
        except urllib.error.HTTPError as e:
            log.warning("Gemini briefing HTTP error (%s)", e.code)
            reason = {
                400: "Gemini rejected the review request (HTTP 400). Check model/API configuration.",
                401: "Gemini rejected the API key. Check GEMINI_API_KEY and restart the backend.",
                403: "Gemini API access denied. Check project permissions.",
                404: "Incident review model unavailable. Set GEMINI_MODEL to an accessible model and restart the backend.",
                429: "Gemini quota or rate limit reached. Retry later.",
            }.get(e.code, f"Gemini service error (HTTP {e.code}). Retry later.")
            return {"status": "failed", "reason": reason}
        except TimeoutError:
            log.warning("Gemini briefing timed out")
            return {"status": "failed", "reason": "Gemini took too long to respond. Retry after the cooldown; recorded facts remain available."}
        except urllib.error.URLError as e:
            log.warning("Gemini briefing connection failed (%s)", type(e.reason).__name__)
            reason = "Gemini took too long to respond." if isinstance(e.reason, TimeoutError) else "Could not connect to Gemini. Check the backend internet connection."
            return {"status": "failed", "reason": reason + " Retry after the cooldown; recorded facts remain available."}
        except (json.JSONDecodeError, KeyError, IndexError, TypeError, AttributeError):
            log.warning("Gemini briefing returned an invalid response structure")
            return {"status": "failed", "reason": "Gemini returned an incomplete or invalid response. Retry after the cooldown; recorded facts remain available."}
        except Exception as e:  # noqa: BLE001
            log.warning("Gemini briefing failed (%s); deterministic briefing kept", type(e).__name__)
            return {"status": "failed", "reason": "Gemini did not return a usable review. Check connectivity and retry."}
        reason = validate_briefing(summary, facts_text, facts.get("location", {}).get("source", ""))
        if reason:
            log.warning("Gemini briefing rejected: %s", reason)
            return {"status": "rejected", "reason": reason}
        return {"status": "ready", "text": summary.strip(), "review": review}


def incident_facts(detail) -> dict:
    """The only information the AI briefing may use."""
    loc = detail.location
    def elapsed(first: str, last: str) -> float | None:
        try:
            begin, end = getattr(detail, first), getattr(detail, last)
            if not begin or not end:
                return None
            seconds = (datetime.fromisoformat(end) - datetime.fromisoformat(begin)).total_seconds()
            return round(seconds, 1) if seconds >= 0 else None
        except (TypeError, ValueError):
            return None
    return {
        "request": "help request from a GuideWing user on a simulated demo journey",
        "status": detail.status,
        "requested_via": {"gesture": "held open-palm gesture", "button": "Help button", "test": "developer TEST control", "imessage": "iMessage text"}[
            detail.request_source
        ],
        "location": {"source": loc.source},
        "timeline": [{"event": e.type, "at": e.at} for e in detail.timeline],
        "timings_seconds": {"request_to_dispatch": elapsed("created_at", "dispatched_at"),
                            "dispatch_to_acceptance": elapsed("dispatched_at", "acknowledged_at"),
                            "acceptance_to_resolution": elapsed("acknowledged_at", "resolved_at"),
                            "dispatch_to_cancellation": elapsed("dispatched_at", "cancelled_at")},
        "blurred_snapshot_attached": bool(detail.snapshot_url),
    }

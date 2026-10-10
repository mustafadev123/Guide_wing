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
import logging
import re
import threading
import urllib.error
import urllib.request
from pathlib import Path
from typing import Callable

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
    if len(summary) > 600:
        return "too long"
    if FORBIDDEN.search(summary):
        return "contains crime classification, navigation or dispatch-control language"
    if location_source == "simulated" and "simulated" not in summary.lower():
        return "dropped the simulated-location label"
    for n in NUMBER.findall(summary):
        if n not in facts_text:
            return f"number {n!r} not present in recorded facts"
    return None


class GeminiBriefing:
    name = "gemini"

    def __init__(self, api_key: str, model: str, post: PostFn = http_post):
        self._key = api_key
        self.model = model
        self._post = post
        self._results: dict[str, dict] = {}
        self._lock = threading.Lock()

    def result(self, incident_id: str) -> dict | None:
        with self._lock:
            return self._results.get(incident_id)

    def request_async(self, incident_id: str, facts: dict) -> None:
        with self._lock:
            if incident_id in self._results:
                return
            self._results[incident_id] = {"status": "pending"}
        threading.Thread(target=self._run, args=(incident_id, facts), daemon=True).start()

    def _run(self, incident_id: str, facts: dict) -> None:
        self._store(incident_id, self.generate(facts))

    def _store(self, incident_id: str, value: dict) -> None:
        with self._lock:
            self._results[incident_id] = value

    def generate(self, facts: dict) -> dict:
        facts_text = json.dumps(facts, indent=1)
        prompt = (
            "You write a short briefing for a simulated local responder in an accessibility demo.\n"
            "Use ONLY the facts in the JSON below. Do not add any fact, guess, cause, identity or intent.\n"
            "Do not classify crimes. Do not give navigation or route instructions. Do not tell anyone "
            "to dispatch resources. If the location source is 'simulated', say 'simulated location'.\n"
            "Copy times exactly as written in the facts or omit them. 2-3 sentences, under 60 words.\n\n"
            f"FACTS:\n{facts_text}"
        )
        body = json.dumps({
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": 0.1,
                "responseMimeType": "application/json",
                "responseSchema": {
                    "type": "OBJECT",
                    "properties": {"summary": {"type": "STRING"}},
                    "required": ["summary"],
                },
            },
        }).encode()
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent"
        try:
            raw = self._post(url, {"x-goog-api-key": self._key, "Content-Type": "application/json"}, body, 15.0)
            data = json.loads(raw)
            text = data["candidates"][0]["content"]["parts"][0]["text"]
            summary = json.loads(text).get("summary")
        except Exception as e:  # noqa: BLE001
            log.warning("Gemini briefing failed (%s); deterministic briefing kept", type(e).__name__)
            return {"status": "failed", "reason": f"request or parse error: {type(e).__name__}"}
        reason = validate_briefing(summary, facts_text, facts.get("location", {}).get("source", ""))
        if reason:
            log.warning("Gemini briefing rejected: %s", reason)
            return {"status": "rejected", "reason": reason}
        return {"status": "ready", "text": summary.strip()}


def incident_facts(detail) -> dict:
    """The only information the AI briefing may use."""
    loc = detail.location
    return {
        "request": "help request from a GuideWing user on a simulated demo journey",
        "status": detail.status,
        "requested_via": {"gesture": "held open-palm gesture", "button": "Help button", "test": "developer TEST control"}[
            detail.request_source
        ],
        "location": {"source": loc.source, "landmark": loc.landmark, "latitude": loc.latitude, "longitude": loc.longitude},
        "timeline": [{"event": e.type, "at": e.at} for e in detail.timeline],
        "blurred_snapshot_attached": bool(detail.snapshot_url),
    }

r"""GuideWing backend (FastAPI). Start with scripts\start.ps1 (uses the create_default_app factory)."""

import asyncio
import logging
import threading
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .clock import SystemClock, utc_iso
from .analytics import AnalyticsSummaries, GeminiAnalytics, SummaryRequest, SummaryResult
from .config import Settings, load_settings
from .db import Database
from .events import EventBus
from .providers import DeterministicBriefing
from .route import Route
from .schemas import (
    AcceptBody, Health, Incident, IncidentCreate, IncidentDetail, IncidentResult, Journey,
    Location, LocationUpdate, SimulationState, VisionStatus,
)
from .services import Conflict, IncidentService, JourneyService, NotFound
from .simulation import MOCK_SCENARIOS, SimulationSnapshotter
from .snapshot import save_blurred_snapshot
from .sponsors import ElevenLabsSpeech, GeminiBriefing, incident_facts
from .vision.service import VisionContext, VisionHooks, VisionService

log = logging.getLogger("guidewing")
VERSION = "0.2.0"
SPA_ROUTES = ("/", "/user", "/responder", "/sim", "/dev")


class Services:
    def __init__(self, settings: Settings, clock, vision: VisionService | None = None):
        self.settings = settings
        self.clock = clock
        self.db = Database(settings.db_path)
        self.bus = EventBus(clock)
        self.route = Route.load(settings.route_path)
        self.journeys = JourneyService(self.db, self.bus, clock, self.route, settings.route_duration_s)
        self.incidents = IncidentService(self.db, self.bus, clock, self.journeys, settings.cancel_window_s)
        self.journeys.incidents = self.incidents
        self.vision = vision or VisionService(settings.vision, clock)
        self.vision.hooks = VisionHooks(
            context=self._vision_context,
            on_palm_hold=self._on_palm_hold,
            on_obstruction=self._on_obstruction,
            on_status_change=lambda st: self.bus.publish("vision.status", {"vision": st.model_dump()}),
        )
        self.snapshotter = SimulationSnapshotter(self.db, self.bus, clock, self.journeys, self.incidents, self.vision)
        self.briefing = DeterministicBriefing()
        self.speech = (
            ElevenLabsSpeech(settings.elevenlabs_api_key, settings.elevenlabs_voice_id,
                             settings.elevenlabs_model_id, settings.tts_cache_dir)
            if settings.elevenlabs_api_key else None
        )
        self.ai_briefing = GeminiBriefing(settings.gemini_api_key, settings.gemini_model) if settings.gemini_api_key else None
        self.analytics = AnalyticsSummaries(
            lambda: self.incidents.list(limit=500), clock,
            GeminiAnalytics(settings.gemini_api_key, settings.gemini_analytics_model) if settings.gemini_api_key else None,
        )
        self._ticker_stop = threading.Event()
        self._ticker: threading.Thread | None = None
        # Startup recovery: overdue pending requests are dispatched now (cancelled stay cancelled).
        recovered = self.incidents.process_due()
        if recovered:
            log.info("recovered %d overdue pending incident(s) as dispatched", len(recovered))
        self.journeys.ensure_current()

    # ---- request creation shared by button, gesture and test --------------

    def create_incident(self, journey_id: str, request_key: str, source: str) -> tuple[Incident, bool]:
        incident, created = self.incidents.create(journey_id, request_key, source)
        if created and source != "test" and self.settings.vision.snapshots:
            threading.Thread(target=self._attach_snapshot, args=(incident.id,), daemon=True).start()
        return incident, created

    def _attach_snapshot(self, incident_id: str) -> None:
        frame = self.vision.latest_raw_frame()
        if frame is None:
            return  # no fresh camera frame -> omit snapshot
        path = save_blurred_snapshot(frame, self.settings.snapshot_dir, incident_id)
        del frame
        if path:
            self.incidents.attach_snapshot(incident_id, path)

    # ---- vision hooks -------------------------------------------------------

    def _vision_context(self) -> VisionContext:
        jid = self.journeys.current_id()
        if not jid:
            return VisionContext(None, False, False)
        try:
            journey = self.journeys.get(jid)
        except NotFound:
            return VisionContext(None, False, False)
        return VisionContext(jid, journey.armed, self.incidents.open_for_journey(jid) is not None)

    def _on_palm_hold(self, journey_id: str, source: str) -> None:
        key = f"{source}-{uuid.uuid4()}"  # one key per hold episode
        try:
            self.create_incident(journey_id, key, source)
        except (Conflict, NotFound) as e:
            log.info("palm hold did not create a request: %s", e)

    def _on_obstruction(self, journey_id: str | None, active: bool, warn: bool, source: str) -> None:
        # Detection status is always published; speech (announce) only for a started journey.
        armed = False
        if journey_id:
            try:
                armed = self.journeys.get(journey_id).armed
            except NotFound:
                pass
        warn = warn and armed
        paused = False
        if active and journey_id:  # pauses only an active journey; idle/ended are untouched
            paused = self.journeys.pause_if_active(journey_id, "obstruction")
        self.bus.publish(
            "vision.obstacle",
            {
                "observation_id": uuid.uuid4().hex,
                "state": "detected" if active else "cleared",
                "announce": bool(warn and active),
                "source": source,
                "journey_paused": paused,
            },
        )

    # ---- background ticker -----------------------------------------------

    def start(self) -> None:
        self._ticker = threading.Thread(target=self._tick_loop, name="ticker", daemon=True)
        self._ticker.start()
        self.vision.start()

    def _tick_loop(self) -> None:
        last = time.monotonic()
        while not self._ticker_stop.wait(self.settings.tick_s):
            now = time.monotonic()
            try:
                self.tick(now - last)
            except Exception:  # noqa: BLE001 - keep the ticker alive
                log.exception("tick failed")
            last = now

    def tick(self, dt_s: float) -> None:
        self.incidents.process_due()
        self.journeys.advance(dt_s)

    def stop(self) -> None:
        self._ticker_stop.set()
        if self._ticker:
            self._ticker.join(timeout=3)
        self.vision.stop()
        self.db.close()


def create_app(settings: Settings | None = None, clock=None, start_background: bool = True,
               vision: VisionService | None = None) -> FastAPI:
    settings = settings or load_settings()
    clock = clock or SystemClock()
    svc = Services(settings, clock, vision)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if start_background:
            svc.start()
        yield
        svc.stop()

    app = FastAPI(title="GuideWing API", version=VERSION, lifespan=lifespan)
    app.state.services = svc
    app.add_middleware(
        CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"], allow_headers=["*"]
    )

    @app.exception_handler(NotFound)
    async def not_found(_: Request, exc: NotFound):
        return JSONResponse({"detail": str(exc)}, status_code=404)

    @app.exception_handler(Conflict)
    async def conflict(_: Request, exc: Conflict):
        return JSONResponse({"detail": str(exc), **exc.extra}, status_code=409)

    # ---- health ------------------------------------------------------------

    @app.get("/api/health", response_model=Health)
    def health():
        try:
            svc.db.query_one("SELECT 1")
            db_ok = "ok"
        except Exception:  # noqa: BLE001
            db_ok = "error"
        return Health(
            version=VERSION, boot_id=svc.bus.boot_id, server_time=utc_iso(clock.now()),
            current_journey_id=svc.journeys.current_id(), database=db_ok, vision=svc.vision.status(),
            speech_provider="elevenlabs (browser fallback)" if svc.speech else "browser",
            briefing_provider="gemini (deterministic fallback)" if svc.ai_briefing else "deterministic",
            dev_controls=settings.dev_controls,
        )

    # ---- journeys ------------------------------------------------------------

    @app.post("/api/journeys", response_model=Journey, status_code=201)
    def create_journey():
        return svc.journeys.create()

    @app.get("/api/journeys/{journey_id}", response_model=Journey)
    def get_journey(journey_id: str):
        return svc.journeys.get(svc.journeys.resolve_id(journey_id))

    @app.post("/api/journeys/{journey_id}/location", response_model=Journey)
    def journey_location(journey_id: str, body: LocationUpdate):
        jid = svc.journeys.resolve_id(journey_id)
        loc = Location(**body.model_dump(), observed_at=utc_iso(clock.now()))
        return svc.journeys.set_location(jid, loc)

    @app.post("/api/journeys/{journey_id}/{action}", response_model=Journey)
    def journey_action(journey_id: str, action: str):
        jid = svc.journeys.resolve_id(journey_id)
        handlers = {
            "start": svc.journeys.start, "pause": svc.journeys.pause,
            "resume": svc.journeys.resume, "end": svc.journeys.end,
        }
        if action not in handlers:
            raise NotFound(f"unknown journey action {action}")
        return handlers[action](jid)

    # ---- incidents ---------------------------------------------------------

    @app.post("/api/incidents", response_model=IncidentResult)
    def create_incident(body: IncidentCreate, response: Response):
        jid = svc.journeys.resolve_id(body.journey_id)
        incident, created = svc.create_incident(jid, body.request_key, body.request_source)
        response.status_code = 201 if created else 200
        return IncidentResult(incident=incident, created=created, changed=created)

    @app.get("/api/incidents", response_model=list[Incident])
    def list_incidents(journey_id: str | None = None, status: str | None = None, limit: int = Query(100, le=500)):
        return svc.incidents.list(journey_id=journey_id, status=status, limit=limit)

    @app.get("/api/incidents/{incident_id}", response_model=IncidentDetail)
    def get_incident(incident_id: str):
        return svc.incidents.detail(incident_id)

    @app.post("/api/incidents/{incident_id}/cancel", response_model=IncidentResult)
    def cancel_incident(incident_id: str):
        incident, changed = svc.incidents.cancel(incident_id)
        return IncidentResult(incident=incident, changed=changed)

    @app.post("/api/incidents/{incident_id}/accept", response_model=IncidentResult)
    def accept_incident(incident_id: str, body: AcceptBody | None = None):
        incident, changed = svc.incidents.accept(incident_id, body.responder if body else None)
        return IncidentResult(incident=incident, changed=changed)

    @app.post("/api/incidents/{incident_id}/resolve", response_model=IncidentResult)
    def resolve_incident(incident_id: str):
        incident, changed = svc.incidents.resolve(incident_id)
        return IncidentResult(incident=incident, changed=changed)

    @app.get("/api/incidents/{incident_id}/snapshot")
    def incident_snapshot(incident_id: str):
        path = svc.incidents.snapshot_path(incident_id)
        if not path or not Path(path).exists():
            raise NotFound("no blurred snapshot for this incident")
        return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "no-store"})

    @app.get("/api/incidents/{incident_id}/briefing")
    def incident_briefing(incident_id: str):
        """Deterministic facts briefing; plus an AI summary when Gemini is configured and the
        summary passed validation. AI generation is asynchronous and never blocks dispatch."""
        detail = svc.incidents.detail(incident_id)
        out = svc.briefing.brief(detail)
        out["deterministic"] = out["text"]
        if svc.ai_briefing is None:
            out["ai_status"] = "not_configured"
            return out
        if detail.status in ("dispatched", "acknowledged", "resolved"):
            svc.ai_briefing.request_async(incident_id, incident_facts(detail))
        result = svc.ai_briefing.result(incident_id) or {"status": "not_requested"}
        out["ai_status"] = result["status"]
        if result["status"] == "ready":
            out.update(provider="gemini", text=result["text"])
        elif "reason" in result:
            out["ai_reason"] = result["reason"]
        return out

    @app.get("/api/speech")
    def speech(text: str = Query(..., min_length=1, max_length=ElevenLabsSpeech.MAX_CHARS)):
        """ElevenLabs audio for a user-page message (cached). 404 when not configured,
        502 on provider failure: the browser then uses its own speech synthesis."""
        if svc.speech is None:
            raise NotFound("speech provider not configured; use browser speech")
        audio = svc.speech.synthesize(text)
        if audio is None:
            return JSONResponse({"detail": "speech provider failed; use browser speech"}, status_code=502)
        return Response(audio, media_type="audio/mpeg", headers={"Cache-Control": "max-age=86400"})

    # ---- explicit aggregate analytics summaries ---------------------------

    @app.get("/api/analytics/config")
    def analytics_configuration():
        return svc.analytics.configuration()

    @app.post("/api/analytics/summary", response_model=SummaryResult)
    def analytics_summary(body: SummaryRequest):
        return svc.analytics.request(body)

    @app.get("/api/analytics/summary/{job_id}", response_model=SummaryResult)
    def analytics_summary_status(job_id: str):
        # Reads a job only; polling never triggers a provider request.
        return svc.analytics.get(job_id)

    # ---- simulation snapshot (Unreal + 2D fallback) -------------------------

    @app.get("/api/simulation/state", response_model=SimulationState)
    def simulation_state(journey_id: str | None = Query(None, description="journey UUID, 'current', or mock-<scenario>")):
        return svc.snapshotter.build(journey_id)

    @app.get("/api/simulation/route")
    def simulation_route():
        """Configured demo route (illustrative simulation waypoints) for the 2D fallback."""
        r = svc.route
        return {
            "route_id": r.route_id,
            "duration_s": settings.route_duration_s,
            "waypoints": [
                {"name": w.name, "latitude": w.latitude, "longitude": w.longitude, "progress": round(m, 4)}
                for w, m in zip(r.waypoints, r.marks)
            ],
        }

    # ---- vision --------------------------------------------------------------

    @app.get("/api/vision/status", response_model=VisionStatus)
    def vision_status():
        return svc.vision.status()

    @app.get("/api/vision/stream")
    async def vision_stream(request: Request):
        if svc.vision.mode not in ("live", "replay"):
            return JSONResponse({"detail": svc.vision.error or "vision unavailable"}, status_code=503)

        async def frames():
            last = -1
            while not await request.is_disconnected():
                seq, jpeg = svc.vision.latest_jpeg()
                if jpeg and seq != last:
                    last = seq
                    yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + jpeg + b"\r\n"
                await asyncio.sleep(0.07)

        return StreamingResponse(frames(), media_type="multipart/x-mixed-replace; boundary=frame")

    # ---- browser live updates ----------------------------------------------

    @app.websocket("/ws/events")
    async def ws_events(websocket: WebSocket):
        await websocket.accept()
        sub = svc.bus.subscribe(asyncio.get_running_loop())
        try:
            await websocket.send_json({
                "boot_id": svc.bus.boot_id, "sequence": svc.bus.last_sequence, "type": "hello",
                "occurred_at": utc_iso(clock.now()), "payload": {},
            })
            while True:
                if sub.overflowed:
                    await websocket.close(code=1013)
                    return
                try:
                    event = await asyncio.wait_for(sub.queue.get(), timeout=15)
                except TimeoutError:
                    event = {"boot_id": svc.bus.boot_id, "sequence": svc.bus.last_sequence, "type": "ping",
                             "occurred_at": utc_iso(clock.now()), "payload": {}}
                await websocket.send_json(event)
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            svc.bus.unsubscribe(sub)

    # ---- developer controls (clearly labeled; never shown as live detection) --

    if settings.dev_controls:

        @app.post("/api/dev/reset", response_model=Journey, tags=["dev"])
        def dev_reset():
            """Start a fresh demo journey (previous journey ended, its open incidents closed)."""
            return svc.journeys.create()

        @app.post("/api/dev/vision/{kind}", tags=["dev"])
        def dev_vision(kind: str):
            if kind not in ("obstruction", "clear", "palm"):
                raise NotFound("use obstruction, clear or palm")
            svc.vision.inject_test(kind)
            return {"injected": kind, "source": "test"}

        @app.get("/api/dev/mock-scenarios", tags=["dev"])
        def dev_mock_scenarios():
            return {"journey_ids": [f"mock-{s}" for s in MOCK_SCENARIOS]}

    # ---- built frontend (single port for the demo) --------------------------

    dist = settings.frontend_dist
    if (dist / "index.html").exists():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")
        for route in SPA_ROUTES:
            app.add_api_route(route, lambda: FileResponse(dist / "index.html"), include_in_schema=False)

    return app


def create_default_app() -> FastAPI:
    """Uvicorn factory: python -m uvicorn backend.app.main:create_default_app --factory"""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    return create_app()

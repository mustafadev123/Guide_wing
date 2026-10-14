"""Journey and incident services: the backend owns every lifecycle decision.

All mutations run inside Database.transaction(), which holds a single lock, so
deadline processing, cancellation and acceptance are serialized. Status changes
use compare-and-set UPDATEs (WHERE status = expected) as a second guard, so a
cancelled incident can never be dispatched by a late timer.

Deadline boundary rule: a pending incident whose dispatch_at <= now is due.
Every cancel/accept first processes due deadlines, so a cancel arriving at or
after the deadline is recorded as "cancelled after dispatch" (responders are told).
"""

import hashlib
import hmac
import json
import secrets
import uuid
from datetime import timedelta

from .clock import parse_iso, utc_iso
from .db import Database
from .events import EventBus
from .route import Route
from .schemas import OPEN_STATUSES, Incident, IncidentDetail, IncidentEvent, Journey, Location

MAX_TICK_S = 1.0  # a stalled ticker must not teleport the companion


class NotFound(Exception):
    pass


class Forbidden(Exception):
    pass


class Conflict(Exception):
    def __init__(self, message: str, **extra):
        super().__init__(message)
        self.extra = extra


class JourneyService:
    def __init__(self, db: Database, bus: EventBus, clock, route: Route, route_duration_s: float):
        self.db = db
        self.bus = bus
        self.clock = clock
        self.route = route
        self.route_duration_s = route_duration_s
        self.incidents: "IncidentService | None" = None  # wired by the app

    # ---- reads -------------------------------------------------------------

    def current_id(self) -> str | None:
        return self.db.get_meta("current_journey_id")

    def ensure_current(self) -> str:
        """Always have one demo journey so renderers can use journey_id=current."""
        with self.db.lock:
            jid = self.current_id()
            if jid and self._row(jid):
                return jid
            return self.create().id

    def resolve_id(self, journey_id: str | None) -> str:
        if journey_id in (None, "", "current"):
            return self.ensure_current()
        return journey_id

    def _row(self, journey_id: str):
        return self.db.query_one("SELECT * FROM journeys WHERE id = ?", (journey_id,))

    def get(self, journey_id: str) -> Journey:
        row = self._row(journey_id)
        if row is None:
            raise NotFound(f"journey {journey_id} not found")
        return self._to_model(row)

    def _to_model(self, row) -> Journey:
        point = self.route.point_at(row["route_progress"])
        if row["device_location_json"]:
            location = Location(**json.loads(row["device_location_json"]))
        elif self.route.has_coordinates:
            location = Location(
                source="simulated",
                latitude=round(point.latitude, 6),
                longitude=round(point.longitude, 6),
                accuracy_m=None,
                landmark=point.landmark,
                observed_at=row["progress_updated_at"] or row["created_at"],
            )
        else:
            location = Location(source="unavailable", landmark=point.landmark)
        return Journey(
            id=row["id"],
            status=row["status"],
            armed=bool(row["armed"]),
            pause_reason=row["pause_reason"],
            route_id=row["route_id"],
            route_progress=round(row["route_progress"], 4),
            waypoint=point.waypoint,
            waypoint_index=point.waypoint_index,
            location=location,
            created_at=row["created_at"],
            version=row["version"],
        )

    # ---- commands ----------------------------------------------------------

    def create(self) -> Journey:
        now = utc_iso(self.clock.now())
        jid = str(uuid.uuid4())
        with self.db.transaction() as c:
            previous = self.db.get_meta("current_journey_id")
            c.execute(
                "INSERT INTO journeys (id, created_at, status, armed, route_id, route_progress, progress_updated_at)"
                " VALUES (?, ?, 'idle', 0, ?, 0, ?)",
                (jid, now, self.route.route_id, now),
            )
            c.execute(
                "INSERT INTO meta (key, value) VALUES ('current_journey_id', ?)"
                " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (jid,),
            )
        if previous and previous != jid and self._row(previous):
            self._end_previous(previous)
        journey = self.get(jid)
        self.bus.publish("journey.updated", {"journey": journey.model_dump(), "current": True})
        return journey

    def _end_previous(self, journey_id: str) -> None:
        if self.incidents:
            self.incidents.close_for_reset(journey_id)
        row = self._row(journey_id)
        if row and row["status"] != "ended":
            self._transition(journey_id, {"idle", "active", "paused"}, "ended", armed=False, pause_reason=None)

    def _transition(self, journey_id, allowed_from, to_status, *, armed, pause_reason, unchanged_ok=True) -> Journey:
        with self.db.transaction() as c:
            row = c.execute("SELECT * FROM journeys WHERE id = ?", (journey_id,)).fetchone()
            if row is None:
                raise NotFound(f"journey {journey_id} not found")
            if row["status"] == to_status and unchanged_ok:
                return self._to_model(row)
            if row["status"] not in allowed_from:
                raise Conflict(f"cannot change journey from {row['status']} to {to_status}", status=row["status"])
            c.execute(
                "UPDATE journeys SET status = ?, armed = ?, pause_reason = ?, version = version + 1,"
                " progress_updated_at = ? WHERE id = ?",
                (to_status, int(armed), pause_reason, utc_iso(self.clock.now()), journey_id),
            )
        journey = self.get(journey_id)
        self.bus.publish("journey.updated", {"journey": journey.model_dump()})
        return journey

    def start(self, journey_id: str) -> Journey:
        return self._transition(journey_id, {"idle"}, "active", armed=True, pause_reason=None)

    def pause(self, journey_id: str, reason: str = "user") -> Journey:
        return self._transition(journey_id, {"active"}, "paused", armed=True, pause_reason=reason)

    def pause_if_active(self, journey_id: str, reason: str) -> bool:
        row = self._row(journey_id)
        if row is None or row["status"] != "active":
            return False
        try:
            self.pause(journey_id, reason)
            return True
        except Conflict:
            return False

    def resume(self, journey_id: str) -> Journey:
        return self._transition(journey_id, {"paused"}, "active", armed=True, pause_reason=None)

    def end(self, journey_id: str) -> Journey:
        return self._transition(journey_id, {"idle", "active", "paused"}, "ended", armed=False, pause_reason=None)

    def set_location(self, journey_id: str, location: Location | None) -> Journey:
        with self.db.transaction() as c:
            row = c.execute("SELECT id FROM journeys WHERE id = ?", (journey_id,)).fetchone()
            if row is None:
                raise NotFound(f"journey {journey_id} not found")
            payload = location.model_dump_json() if location else None
            c.execute(
                "UPDATE journeys SET device_location_json = ?, version = version + 1 WHERE id = ?",
                (payload, journey_id),
            )
        journey = self.get(journey_id)
        self.bus.publish("journey.updated", {"journey": journey.model_dump()})
        return journey

    def advance(self, dt_s: float) -> None:
        """Move active journeys along the route. Called only by the background ticker."""
        dt_s = min(max(dt_s, 0.0), MAX_TICK_S)
        if dt_s == 0:
            return
        arrived = []
        with self.db.transaction() as c:
            rows = c.execute("SELECT id, route_progress FROM journeys WHERE status = 'active'").fetchall()
            now = utc_iso(self.clock.now())
            for row in rows:
                progress = min(1.0, row["route_progress"] + dt_s / self.route_duration_s)
                c.execute(
                    "UPDATE journeys SET route_progress = ?, progress_updated_at = ? WHERE id = ?",
                    (progress, now, row["id"]),
                )
                if progress >= 1.0:
                    arrived.append(row["id"])
        if rows:
            self.bus.bump_revision()
        for jid in arrived:
            try:
                self.end(jid)
            except Conflict:
                pass


class IncidentService:
    def __init__(self, db: Database, bus: EventBus, clock, journeys: JourneyService, cancel_window_s: float):
        self.db = db
        self.bus = bus
        self.clock = clock
        self.journeys = journeys
        self.cancel_window_s = cancel_window_s

    # ---- reads -------------------------------------------------------------

    def _to_model(self, row) -> Incident:
        return Incident(
            id=row["id"],
            journey_id=row["journey_id"],
            request_key=row["request_key"],
            status=row["status"],
            request_source=row["request_source"],
            created_at=row["created_at"],
            dispatch_at=row["dispatch_at"],
            dispatched_at=row["dispatched_at"],
            acknowledged_at=row["acknowledged_at"],
            cancelled_at=row["cancelled_at"],
            resolved_at=row["resolved_at"],
            updated_at=row["updated_at"],
            location=Location(**json.loads(row["location_json"])),
            snapshot_url=f"/api/incidents/{row['id']}/snapshot" if row["snapshot_path"] else None,
            responder=row["responder"],
            version=row["version"],
            is_test=row["request_source"] == "test",
            on_my_way_at=row["on_my_way_at"],
        )

    def get(self, incident_id: str) -> Incident:
        self.process_due()
        row = self.db.query_one("SELECT * FROM incidents WHERE id = ?", (incident_id,))
        if row is None:
            raise NotFound(f"incident {incident_id} not found")
        return self._to_model(row)

    def detail(self, incident_id: str) -> IncidentDetail:
        incident = self.get(incident_id)
        events = self.db.query(
            "SELECT type, at, detail FROM incident_events WHERE incident_id = ? ORDER BY seq", (incident_id,)
        )
        return IncidentDetail(**incident.model_dump(), timeline=[IncidentEvent(**dict(e)) for e in events])

    def list(self, journey_id: str | None = None, status: str | None = None, limit: int = 100) -> list[Incident]:
        self.process_due()
        sql, params = "SELECT * FROM incidents WHERE 1=1", []
        if journey_id:
            sql += " AND journey_id = ?"
            params.append(journey_id)
        if status:
            sql += " AND status = ?"
            params.append(status)
        sql += " ORDER BY created_at DESC LIMIT ?"
        params.append(limit)
        return [self._to_model(r) for r in self.db.query(sql, tuple(params))]

    def open_for_journey(self, journey_id: str) -> Incident | None:
        row = self.db.query_one(
            "SELECT * FROM incidents WHERE journey_id = ? AND status IN ('pending','dispatched','acknowledged')",
            (journey_id,),
        )
        return self._to_model(row) if row else None

    def latest_for_journey(self, journey_id: str) -> Incident | None:
        row = self.db.query_one(
            "SELECT * FROM incidents WHERE journey_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
            (journey_id,),
        )
        return self._to_model(row) if row else None

    def snapshot_path(self, incident_id: str) -> str | None:
        row = self.db.query_one("SELECT snapshot_path FROM incidents WHERE id = ?", (incident_id,))
        if row is None:
            raise NotFound(f"incident {incident_id} not found")
        return row["snapshot_path"]

    # ---- commands ----------------------------------------------------------

    def create(self, journey_id: str, request_key: str, request_source: str) -> tuple[Incident, bool]:
        """Idempotent: the same request_key always returns the same incident."""
        self.process_due()
        now = self.clock.now()
        with self.db.transaction() as c:
            existing = c.execute("SELECT * FROM incidents WHERE request_key = ?", (request_key,)).fetchone()
            if existing is not None:
                if existing["journey_id"] != journey_id:
                    raise Conflict("request_key already used for another journey")
                return self._to_model(existing), False
            journey = c.execute("SELECT * FROM journeys WHERE id = ?", (journey_id,)).fetchone()
            if journey is None:
                raise NotFound(f"journey {journey_id} not found")
            if not journey["armed"] or journey["status"] not in ("active", "paused"):
                raise Conflict("journey is not armed; start the journey first", journey_status=journey["status"])
            open_row = c.execute(
                "SELECT id FROM incidents WHERE journey_id = ? AND status IN ('pending','dispatched','acknowledged')",
                (journey_id,),
            ).fetchone()
            if open_row is not None:
                raise Conflict("journey already has an active incident", active_incident_id=open_row["id"])
            location = self.journeys.get(journey_id).location
            iid = str(uuid.uuid4())
            created = utc_iso(now)
            c.execute(
                "INSERT INTO incidents (id, journey_id, request_key, kind, status, request_source, created_at,"
                " dispatch_at, updated_at, location_json) VALUES (?, ?, ?, 'user_sos', 'pending', ?, ?, ?, ?, ?)",
                (
                    iid, journey_id, request_key, request_source, created,
                    utc_iso(now + timedelta(seconds=self.cancel_window_s)), created,
                    location.model_dump_json(),
                ),
            )
            self._log(c, iid, "created", f"request_source={request_source}")
        self.journeys.pause_if_active(journey_id, "help_request")
        incident = self.get(iid)
        self._publish(incident, "created", None)
        return incident, True

    def process_due(self) -> list[Incident]:
        """Dispatch pending incidents whose deadline has passed (also on startup recovery)."""
        now = utc_iso(self.clock.now())
        dispatched = []
        with self.db.transaction() as c:
            due = c.execute(
                "SELECT id FROM incidents WHERE status = 'pending' AND dispatch_at <= ?", (now,)
            ).fetchall()
            for row in due:
                cur = c.execute(
                    "UPDATE incidents SET status = 'dispatched', dispatched_at = ?, updated_at = ?,"
                    " version = version + 1 WHERE id = ? AND status = 'pending'",
                    (now, now, row["id"]),
                )
                if cur.rowcount == 1:
                    self._log(c, row["id"], "dispatched", "cancellation window expired")
                    dispatched.append(row["id"])
        out = []
        for iid in dispatched:
            row = self.db.query_one("SELECT * FROM incidents WHERE id = ?", (iid,))
            incident = self._to_model(row)
            self._publish(incident, "dispatched", "pending")
            out.append(incident)
        return out

    def _change(self, incident_id, allowed_from, to_status, stamp_col, detail, responder=None, token_hash=None) -> tuple[Incident, bool]:
        self.process_due()
        now = utc_iso(self.clock.now())
        with self.db.transaction() as c:
            row = c.execute("SELECT * FROM incidents WHERE id = ?", (incident_id,)).fetchone()
            if row is None:
                raise NotFound(f"incident {incident_id} not found")
            previous = row["status"]
            if previous == to_status:
                return self._to_model(row), False  # idempotent retry / second responder
            if previous not in allowed_from:
                raise Conflict(f"cannot change incident from {previous} to {to_status}", status=previous)
            cur = c.execute(
                f"UPDATE incidents SET status = ?, {stamp_col} = ?, updated_at = ?, version = version + 1,"
                " responder = COALESCE(?, responder), responder_token_hash = COALESCE(?, responder_token_hash)"
                " WHERE id = ? AND status = ?",
                (to_status, now, now, responder, token_hash, incident_id, previous),
            )
            if cur.rowcount != 1:  # defensive; the lock already serializes writers
                raise Conflict("incident changed concurrently; retry")
            self._log(c, incident_id, to_status, detail)
        incident = self.get(incident_id)
        self._publish(incident, to_status, previous)
        return incident, True

    def cancel(self, incident_id: str) -> tuple[Incident, bool]:
        return self._change(incident_id, {"pending", "dispatched"}, "cancelled", "cancelled_at", "cancelled by user")

    def accept(self, incident_id: str, responder: str | None = None) -> tuple[Incident, bool, str | None]:
        """Returns (incident, changed, responder_token). The token goes only to the winning caller."""
        row = self.db.query_one("SELECT status, dispatch_at FROM incidents WHERE id = ?", (incident_id,))
        if row is not None and row["status"] == "pending" and parse_iso(row["dispatch_at"]) > self.clock.now():
            raise Conflict("incident has not been dispatched yet", status="pending")
        token = secrets.token_urlsafe(24)
        incident, changed = self._change(
            incident_id, {"dispatched"}, "acknowledged", "acknowledged_at",
            f"accepted by {responder or 'responder'}", responder=responder or "Local responder (simulated)",
            token_hash=_hash(token),
        )
        return incident, changed, token if changed else None

    def on_my_way(self, incident_id: str, responder_token: str) -> tuple[Incident, bool]:
        """Progress update by the assigned responder; idempotent. The status stays 'acknowledged'."""
        self.process_due()
        now = utc_iso(self.clock.now())
        with self.db.transaction() as c:
            row = c.execute("SELECT * FROM incidents WHERE id = ?", (incident_id,)).fetchone()
            if row is None:
                raise NotFound(f"incident {incident_id} not found")
            if row["status"] != "acknowledged":
                raise Conflict(f"On my way is only possible for an accepted request; this one is {row['status']}",
                               status=row["status"])
            stored = row["responder_token_hash"]
            if not stored or not hmac.compare_digest(stored, _hash(responder_token)):
                raise Forbidden("only the responder who accepted this request can report On my way")
            if row["on_my_way_at"]:
                return self._to_model(row), False  # repeated command: no second update or event
            c.execute(
                "UPDATE incidents SET on_my_way_at = ?, updated_at = ?, version = version + 1"
                " WHERE id = ? AND status = 'acknowledged' AND on_my_way_at IS NULL",
                (now, now, incident_id),
            )
            self._log(c, incident_id, "on_my_way", f"{row['responder'] or 'responder'} reported on the way")
        incident = self.get(incident_id)
        self._publish(incident, "on_my_way", "acknowledged")
        return incident, True

    def resolve(self, incident_id: str) -> tuple[Incident, bool]:
        return self._change(incident_id, {"acknowledged"}, "resolved", "resolved_at", "resolved by responder")

    def attach_snapshot(self, incident_id: str, path: str) -> None:
        with self.db.transaction() as c:
            c.execute("UPDATE incidents SET snapshot_path = ? WHERE id = ?", (path, incident_id))
            self._log(c, incident_id, "snapshot_attached", "blurred full-frame snapshot")
        self._publish(self.get(incident_id), "snapshot_attached", None)

    def close_for_reset(self, journey_id: str) -> None:
        """Demo reset: close open incidents of a journey that is being replaced."""
        for incident in self.list(journey_id=journey_id):
            try:
                if incident.status in ("pending", "dispatched"):
                    self.cancel(incident.id)
                elif incident.status == "acknowledged":
                    self.resolve(incident.id)
            except Conflict:
                pass

    # ---- helpers -----------------------------------------------------------

    def _log(self, c, incident_id: str, type_: str, detail: str | None) -> None:
        c.execute(
            "INSERT INTO incident_events (incident_id, type, at, detail) VALUES (?, ?, ?, ?)",
            (incident_id, type_, utc_iso(self.clock.now()), detail),
        )

    def _publish(self, incident: Incident, transition: str, previous: str | None) -> None:
        self.bus.publish(
            "incident.updated",
            {"incident": incident.model_dump(), "transition": transition, "previous_status": previous},
        )


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


__all__ = ["JourneyService", "IncidentService", "NotFound", "Conflict", "Forbidden", "OPEN_STATUSES"]

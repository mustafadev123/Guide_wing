"""Consistent simulation snapshot for Unreal and the 2D fallback.

Reads never advance the route; they only dispatch overdue pending incidents
(an expired pending incident must not be reported as pending).

Mock fixtures: journey_id values starting with "mock-" return canned,
clearly labeled snapshots (data_source="mock") with the exact same shape.
"""

from datetime import timedelta

from .clock import parse_iso, utc_iso
from .schemas import Incident, Journey, Location, SimulationState, SnapshotIncident, SnapshotVision

MOCK_SCENARIOS = (
    "active", "paused", "obstacle", "pending", "dispatched", "acknowledged", "cancelled", "resolved", "no-location",
)


def snapshot_incident(incident: Incident | None, now) -> SnapshotIncident | None:
    if incident is None:
        return None
    remaining = None
    if incident.status == "pending":
        remaining = max(0.0, round((parse_iso(incident.dispatch_at) - now).total_seconds(), 2))
    return SnapshotIncident(
        id=incident.id,
        status=incident.status,
        request_source=incident.request_source,
        created_at=incident.created_at,
        dispatch_at=incident.dispatch_at,
        seconds_until_dispatch=remaining,
        acknowledged_at=incident.acknowledged_at,
        updated_at=incident.updated_at,
        version=incident.version,
    )


class SimulationSnapshotter:
    def __init__(self, db, bus, clock, journeys, incidents, vision):
        self.db = db
        self.bus = bus
        self.clock = clock
        self.journeys = journeys
        self.incidents = incidents
        self.vision = vision

    def build(self, journey_id: str | None) -> SimulationState:
        if journey_id and journey_id.startswith("mock-"):
            return self.mock(journey_id.removeprefix("mock-"))
        self.incidents.process_due()
        jid = self.journeys.resolve_id(journey_id)
        with self.db.lock:  # one consistent read of journey + incidents + revision
            now = self.clock.now()
            journey = self.journeys.get(jid)
            active = self.incidents.open_for_journey(jid)
            last = self.incidents.latest_for_journey(jid)
            revision = self.bus.revision
        v = self.vision.status()
        return SimulationState(
            data_source="live",
            boot_id=self.bus.boot_id,
            revision=revision,
            sampled_at=utc_iso(now),
            journey=journey,
            active_incident=snapshot_incident(active, now),
            last_incident=snapshot_incident(last, now),
            vision=SnapshotVision(
                input_mode=v.input_mode,
                ready=v.ready,
                obstruction_active=v.obstruction_active,
                obstruction_source=v.obstruction_source,
                last_observed_at=v.last_observed_at,
                error=v.error,
            ),
        )

    def mock(self, scenario: str) -> SimulationState:
        from .services import NotFound

        if scenario not in MOCK_SCENARIOS:
            raise NotFound(f"unknown mock scenario {scenario!r}; use one of {', '.join(MOCK_SCENARIOS)}")
        now = self.clock.now()
        t = lambda s: utc_iso(now + timedelta(seconds=s))  # noqa: E731
        status, pause_reason, progress = "active", None, 0.42
        incident_status = None
        if scenario in ("paused",):
            status, pause_reason = "paused", "user"
        if scenario == "obstacle":
            status, pause_reason = "paused", "obstruction"
        if scenario in ("pending", "dispatched", "acknowledged", "cancelled", "resolved"):
            status, pause_reason = "paused", "help_request"
            incident_status = scenario
        location = Location(
            source="simulated", latitude=33.75133, longitude=-84.38447, accuracy_m=None,
            landmark="Fountain plaza", observed_at=t(0),
        )
        if scenario == "no-location":
            location = Location(source="unavailable", landmark=None)
        journey = Journey(
            id=f"mock-{scenario}", status=status, armed=True, pause_reason=pause_reason,
            route_id="campus_demo_v1", route_progress=progress, waypoint="Library crossing",
            waypoint_index=1, location=location, created_at=t(-60), version=3,
        )
        incident = None
        if incident_status:
            created = -4 if incident_status == "pending" else -25
            incident = SnapshotIncident(
                id="mock-incident-0001", status=incident_status, request_source="gesture",
                created_at=t(created), dispatch_at=t(created + 10),
                seconds_until_dispatch=6.0 if incident_status == "pending" else None,
                acknowledged_at=t(-8) if incident_status in ("acknowledged", "resolved") else None,
                updated_at=t(-5),
                version={"pending": 1, "dispatched": 2, "acknowledged": 3, "cancelled": 2, "resolved": 4}[incident_status],
            )
        return SimulationState(
            data_source="mock",
            boot_id="mock-boot",
            revision=1,
            sampled_at=t(0),
            journey=journey,
            active_incident=incident if incident_status not in (None, "cancelled", "resolved") else None,
            last_incident=incident,
            vision=SnapshotVision(
                input_mode="test", ready=False, obstruction_active=scenario == "obstacle",
                obstruction_source="test" if scenario == "obstacle" else None, last_observed_at=None,
                error="mock snapshot: no vision provider",
            ),
        )

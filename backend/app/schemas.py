"""Wire contract (API + Unreal snapshot). See docs/CONTRACT.md and docs/UNREAL_INTEGRATION.md.

JSON keys are snake_case, timestamps are ISO-8601 UTC with a Z suffix, and
nullable fields are always present (sent as null) so clients see a stable shape.
"""

from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

SCHEMA_VERSION = 1

JourneyStatus = Literal["idle", "active", "paused", "ended"]
PauseReason = Literal["user", "obstruction", "help_request"]
IncidentStatus = Literal["pending", "dispatched", "acknowledged", "cancelled", "resolved"]
RequestSource = Literal["gesture", "button", "test", "imessage", "voice"]
LocationSource = Literal["simulated", "device", "unavailable"]
InputMode = Literal["live", "replay", "test", "unavailable"]

OPEN_STATUSES = ("pending", "dispatched", "acknowledged")


class Location(BaseModel):
    source: LocationSource
    latitude: float | None = None
    longitude: float | None = None
    accuracy_m: float | None = None
    landmark: str | None = None
    observed_at: str | None = None


class LocationUpdate(BaseModel):
    """Optional device location input. Core demo location stays simulated."""

    source: Literal["device", "unavailable"]
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    accuracy_m: float | None = Field(default=None, ge=0)
    landmark: str | None = Field(default=None, max_length=120)

    @model_validator(mode="after")
    def coordinates_match_source(self):
        has = self.latitude is not None and self.longitude is not None
        if self.source == "device" and not has:
            raise ValueError("device location requires latitude and longitude")
        if self.source == "unavailable" and (self.latitude is not None or self.longitude is not None):
            raise ValueError("unavailable location must not carry coordinates")
        return self


class Journey(BaseModel):
    id: str
    status: JourneyStatus
    armed: bool
    pause_reason: PauseReason | None
    route_id: str
    route_progress: float
    waypoint: str | None
    waypoint_index: int | None
    location: Location
    created_at: str
    version: int


class Incident(BaseModel):
    id: str
    journey_id: str
    request_key: str
    kind: Literal["user_sos"] = "user_sos"
    status: IncidentStatus
    request_source: RequestSource
    created_at: str
    dispatch_at: str
    dispatched_at: str | None
    acknowledged_at: str | None
    cancelled_at: str | None
    resolved_at: str | None
    updated_at: str
    location: Location
    snapshot_url: str | None
    responder: str | None
    version: int
    is_test: bool
    # Separate progress update by the assigned responder; null until reported. Not a status.
    on_my_way_at: str | None = None


class IncidentEvent(BaseModel):
    type: str
    at: str
    detail: str | None


class IncidentDetail(Incident):
    timeline: list[IncidentEvent]


class IncidentCreate(BaseModel):
    journey_id: str
    request_key: str = Field(min_length=8, max_length=128)
    request_source: RequestSource = "button"

    @field_validator("request_key")
    @classmethod
    def printable(cls, v: str) -> str:
        if not v.isprintable() or v.strip() != v:
            raise ValueError("request_key must be printable without surrounding spaces")
        return v


class IncidentResult(BaseModel):
    incident: Incident
    created: bool = False
    changed: bool = False
    # Returned once, only to the client whose accept succeeded; required for "On my way".
    responder_token: str | None = None


class OnMyWayBody(BaseModel):
    responder_token: str = Field(min_length=16, max_length=128)


class AcceptBody(BaseModel):
    responder: str | None = Field(default=None, max_length=60)


class VisionStatus(BaseModel):
    input_mode: InputMode
    ready: bool
    source_label: str | None
    error: str | None
    last_observed_at: str | None
    frame_age_s: float | None
    fps: float | None
    inference_ms: float | None
    obstruction_active: bool
    obstruction_source: InputMode | None
    gesture_armed: bool
    gesture_hold_progress: float


# ----- Unreal / 2D snapshot -------------------------------------------------


class SnapshotIncident(BaseModel):
    id: str
    status: IncidentStatus
    request_source: RequestSource
    created_at: str
    dispatch_at: str
    seconds_until_dispatch: float | None
    acknowledged_at: str | None
    updated_at: str
    version: int
    on_my_way_at: str | None = None


class SnapshotVision(BaseModel):
    input_mode: InputMode
    ready: bool
    obstruction_active: bool
    # live|replay = camera detection, test = developer-injected; null when no obstruction
    obstruction_source: InputMode | None = None
    last_observed_at: str | None
    error: str | None


class SimulationState(BaseModel):
    schema_version: int = SCHEMA_VERSION
    data_source: Literal["live", "mock"]
    boot_id: str
    revision: int
    sampled_at: str
    journey: Journey
    active_incident: SnapshotIncident | None
    last_incident: SnapshotIncident | None
    vision: SnapshotVision


class Health(BaseModel):
    status: Literal["ok"] = "ok"
    service: str = "guidewing-backend"
    version: str
    schema_version: int = SCHEMA_VERSION
    boot_id: str
    server_time: str
    current_journey_id: str | None
    database: Literal["ok", "error"]
    vision: VisionStatus
    speech_provider: str
    briefing_provider: str
    dev_controls: bool

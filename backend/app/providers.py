"""Replaceable provider interfaces for speech and responder briefings.

Core runtime: speech is synthesized by the user's browser (single speech owner),
and briefings are deterministic text built only from recorded incident facts.
Optional sponsor providers (ElevenLabs speech, Gemini briefings) live in sponsors.py;
their failure never delays request, cancel or accept.
"""

from typing import Protocol

from .schemas import IncidentDetail


class BriefingProvider(Protocol):
    name: str

    def brief(self, incident: IncidentDetail) -> dict: ...


class DeterministicBriefing:
    name = "deterministic"

    def brief(self, incident: IncidentDetail) -> dict:
        loc = incident.location
        if loc.source == "unavailable":
            where = "Location unavailable."
        else:
            label = "Simulated location" if loc.source == "simulated" else "Device-reported location"
            coords = (
                f" ({loc.latitude:.5f}, {loc.longitude:.5f})" if loc.latitude is not None and loc.longitude is not None else ""
            )
            where = f"{label}: near {loc.landmark or 'unknown landmark'}{coords}."
        how = {
            "gesture": "Requested with a held open-palm gesture.",
            "button": "Requested with the Help button.",
            "test": "TEST request injected by a developer control.",
        }[incident.request_source]
        lines = [
            "Help request from a GuideWing user (simulated demo journey).",
            f"Status: {incident.status}.",
            how,
            where,
            f"Requested at {incident.created_at}.",
        ]
        if incident.dispatched_at:
            lines.append(f"Dispatched at {incident.dispatched_at} after the cancellation window.")
        if incident.acknowledged_at:
            lines.append(f"Accepted at {incident.acknowledged_at} by {incident.responder}.")
        if incident.cancelled_at:
            lines.append(f"Cancelled by the user at {incident.cancelled_at}.")
        if incident.resolved_at:
            lines.append(f"Resolved at {incident.resolved_at}.")
        if incident.snapshot_url:
            lines.append("A blurred camera snapshot is attached.")
        return {"provider": self.name, "text": "\n".join(lines)}


"""Fixed demonstration route: maps normalized progress (0..1) to configured waypoints.

Coordinates are configured simulation data. They are never inferred from video
or Unreal world units.
"""

import json
import math
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Waypoint:
    name: str
    latitude: float | None
    longitude: float | None


@dataclass(frozen=True)
class RoutePoint:
    latitude: float | None
    longitude: float | None
    waypoint: str  # last waypoint passed
    waypoint_index: int
    landmark: str  # nearest waypoint


class Route:
    def __init__(self, route_id: str, waypoints: list[Waypoint]):
        if len(waypoints) < 2:
            raise ValueError("route needs at least two waypoints")
        self.route_id = route_id
        self.waypoints = waypoints
        self.has_coordinates = all(w.latitude is not None and w.longitude is not None for w in waypoints)
        lengths = []
        for a, b in zip(waypoints, waypoints[1:]):
            lengths.append(_distance(a, b) if self.has_coordinates else 1.0)
        total = sum(lengths) or 1.0
        # cumulative fraction at each waypoint
        self.marks = [0.0]
        for seg in lengths:
            self.marks.append(self.marks[-1] + seg / total)
        self.marks[-1] = 1.0

    @classmethod
    def load(cls, path: Path) -> "Route":
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        return cls(
            data["route_id"],
            [Waypoint(w["name"], w.get("latitude"), w.get("longitude")) for w in data["waypoints"]],
        )

    def point_at(self, progress: float) -> RoutePoint:
        p = min(max(progress, 0.0), 1.0)
        i = max(k for k, m in enumerate(self.marks) if m <= p)
        i = min(i, len(self.waypoints) - 2) if p < 1.0 else len(self.waypoints) - 1
        if p >= 1.0:
            w = self.waypoints[-1]
            return RoutePoint(w.latitude, w.longitude, w.name, i, w.name)
        a, b = self.waypoints[i], self.waypoints[i + 1]
        span = self.marks[i + 1] - self.marks[i]
        f = (p - self.marks[i]) / span if span else 0.0
        lat = lon = None
        if self.has_coordinates:
            lat = a.latitude + (b.latitude - a.latitude) * f
            lon = a.longitude + (b.longitude - a.longitude) * f
        landmark = a.name if f < 0.5 else b.name
        return RoutePoint(lat, lon, a.name, i, landmark)


def _distance(a: Waypoint, b: Waypoint) -> float:
    # equirectangular approximation; fine for a few hundred meters
    lat = math.radians((a.latitude + b.latitude) / 2)
    dx = math.radians(b.longitude - a.longitude) * math.cos(lat)
    dy = math.radians(b.latitude - a.latitude)
    return math.hypot(dx, dy) * 6_371_000

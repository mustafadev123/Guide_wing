"""Pure temporal logic for vision observations. No camera, no models: unit-testable
with controlled timestamps. Times are monotonic seconds (frame timestamps).
"""

from dataclasses import dataclass


def overlap_fraction(box, region) -> float:
    """Fraction of the box area that lies inside the region. Both normalized x1,y1,x2,y2."""
    bx1, by1, bx2, by2 = box
    rx1, ry1, rx2, ry2 = region
    iw = max(0.0, min(bx2, rx2) - max(bx1, rx1))
    ih = max(0.0, min(by2, ry2) - max(by1, ry1))
    area = max(1e-9, (bx2 - bx1) * (by2 - by1))
    return (iw * ih) / area


@dataclass
class PalmUpdate:
    triggered: bool
    hold_progress: float  # 0..1 toward a trigger, for UI feedback only
    latched: bool  # a hold already produced (or was consumed by) an episode


class PalmHoldDetector:
    """Open_Palm held for hold_s while armed creates exactly one request.

    - Brief waves and noisy single frames don't trigger (continuous hold needed,
      tolerating gaps up to gap_tolerance_s between positive frames).
    - After a trigger the detector is latched. It rearms only when the palm has
      been released for release_s AND there is no open incident, so a palm still
      held after cancelling cannot immediately retrigger.
    - A hold completed while an incident is already open (e.g. Help button) is
      consumed: the participant must release before a new hold counts.
    - Not armed (journey idle/ended) resets the hold.
    """

    def __init__(self, hold_s=2.0, gap_tolerance_s=0.35, release_s=1.0):
        self.hold_s = hold_s
        self.gap_tolerance_s = gap_tolerance_s
        self.release_s = release_s
        self.hold_start: float | None = None
        self.last_palm: float | None = None
        self.latched = False

    def update(self, t: float, palm: bool, armed: bool, incident_open: bool) -> PalmUpdate:
        if palm:
            if self.hold_start is None or (self.last_palm is not None and t - self.last_palm > self.gap_tolerance_s):
                self.hold_start = t
            self.last_palm = t
        elif self.last_palm is not None and t - self.last_palm > self.gap_tolerance_s:
            self.hold_start = None

        released_for = None if self.last_palm is None else t - self.last_palm
        if self.latched and not palm and (released_for is None or released_for >= self.release_s) and not incident_open:
            self.latched = False

        if not armed:
            self.hold_start = None
            return PalmUpdate(False, 0.0, self.latched)

        held = 0.0 if self.hold_start is None else t - self.hold_start
        progress = 0.0 if self.latched else min(1.0, held / self.hold_s)
        if not self.latched and self.hold_start is not None and held >= self.hold_s:
            self.latched = True
            if incident_open:
                return PalmUpdate(False, 0.0, True)  # consumed; release required
            return PalmUpdate(True, 1.0, True)
        return PalmUpdate(False, progress, self.latched)


@dataclass
class ObstructionUpdate:
    warn: bool  # emit a warning (announce) now
    became_active: bool
    cleared: bool
    active: bool


class ObstructionMonitor:
    """A chair overlapping the configured path region for persist_s raises a warning.

    - Brief detections (shorter than persist_s, allowing small gaps) are ignored.
    - The obstruction clears after clear_s without a qualifying detection.
    - Warnings are rate-limited by cooldown_s: a chair that flickers away and
      back within the cooldown becomes active again silently.
    - Warnings are only spoken while can_warn is true (journey started). An
      obstruction seen before that stays visible as status, is not announced and
      does not consume the cooldown; if it is still present once the journey
      starts, it is announced then (once).
    """

    def __init__(self, persist_s=1.0, clear_s=1.5, cooldown_s=10.0, gap_tolerance_s=0.4):
        self.persist_s = persist_s
        self.clear_s = clear_s
        self.cooldown_s = cooldown_s
        self.gap_tolerance_s = gap_tolerance_s
        self.seen_start: float | None = None
        self.last_seen: float | None = None
        self.active = False
        self.announced = False  # this activation episode has been announced (or deliberately silenced)
        self.last_warning: float | None = None

    def update(self, t: float, present: bool, can_warn: bool = True) -> ObstructionUpdate:
        became_active = cleared = warn = False
        if present:
            if self.seen_start is None or (self.last_seen is not None and t - self.last_seen > self.gap_tolerance_s):
                self.seen_start = t
            self.last_seen = t
            if not self.active and t - self.seen_start >= self.persist_s:
                self.active = True
                self.announced = False
                became_active = True
        else:
            if self.last_seen is not None and t - self.last_seen > self.gap_tolerance_s:
                self.seen_start = None
            if self.active and (self.last_seen is None or t - self.last_seen >= self.clear_s):
                self.active = False
                cleared = True
        if self.active and not self.announced and can_warn:
            self.announced = True
            if self.last_warning is None or t - self.last_warning >= self.cooldown_s:
                warn = True
                self.last_warning = t
        return ObstructionUpdate(warn, became_active, cleared, self.active)

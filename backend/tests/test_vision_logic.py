"""Temporal gesture/obstruction rules with controlled timestamps (no camera, no model)."""

import numpy as np

from backend.app.snapshot import blur_full_frame
from backend.app.vision.logic import ObstructionMonitor, PalmHoldDetector, overlap_fraction

FPS = 15
DT = 1 / FPS


def run(det, seconds, palm, armed=True, incident_open=False, start=0.0):
    triggers = 0
    t = start
    for _ in range(int(round(seconds * FPS))):
        t += DT
        triggers += det.update(t, palm, armed, incident_open).triggered
    return triggers, t


def test_sustained_palm_triggers_once():
    d = PalmHoldDetector()
    n, t = run(d, 6.0, True)  # held three times longer than needed
    assert n == 1


def test_brief_wave_does_not_trigger():
    d = PalmHoldDetector()
    t = 0.0
    total = 0
    for _ in range(5):  # five 0.8 s waves with 0.6 s gaps
        n, t = run(d, 0.8, True, start=t)
        total += n
        n, t = run(d, 0.6, False, start=t)
        total += n
    assert total == 0


def test_noisy_prediction_tolerated_within_gap():
    d = PalmHoldDetector(gap_tolerance_s=0.35)
    t, total = 0.0, 0
    for i in range(int(3.0 * FPS)):  # every 5th frame misses the palm (~0.07 s gap)
        t += DT
        total += d.update(t, i % 5 != 0, True, False).triggered
    assert total == 1


def test_long_gap_restarts_hold():
    d = PalmHoldDetector()
    n1, t = run(d, 1.5, True)
    n2, t = run(d, 0.5, False, start=t)  # longer than gap tolerance
    n3, t = run(d, 1.5, True, start=t)
    assert n1 + n2 + n3 == 0


def test_held_palm_after_cancellation_does_not_retrigger():
    d = PalmHoldDetector()
    n, t = run(d, 2.5, True)
    assert n == 1
    # incident cancelled (no longer open) but the palm stays raised
    n, t = run(d, 5.0, True, incident_open=False, start=t)
    assert n == 0


def test_rearm_requires_release_and_terminal_incident():
    d = PalmHoldDetector(release_s=1.0)
    n, t = run(d, 2.5, True)
    assert n == 1
    # released while the incident is still open: stays latched
    n, t = run(d, 2.0, False, incident_open=True, start=t)
    n2, t = run(d, 3.0, True, incident_open=True, start=t)
    assert n + n2 == 0
    # incident terminal but released only briefly
    n, t = run(d, 0.5, False, start=t)
    n2, t = run(d, 3.0, True, start=t)
    assert n + n2 == 0
    # released >= 1 s with terminal incident: rearmed, new hold triggers once
    n, t = run(d, 1.2, False, start=t)
    n2, t = run(d, 3.0, True, start=t)
    assert n == 0 and n2 == 1


def test_disarmed_journey_never_triggers():
    d = PalmHoldDetector()
    n, t = run(d, 5.0, True, armed=False)
    assert n == 0
    # hold must happen while armed: arming mid-hold restarts the timer
    n, t = run(d, 1.0, True, armed=True, start=t)
    assert n == 0
    n, t = run(d, 1.2, True, armed=True, start=t)
    assert n == 1


def test_hold_while_incident_open_is_consumed():
    d = PalmHoldDetector()
    n, t = run(d, 3.0, True, incident_open=True)  # e.g. Help button already used
    assert n == 0
    n, t = run(d, 3.0, True, incident_open=False, start=t)  # still held after it ends
    assert n == 0


def test_obstruction_requires_persistence():
    m = ObstructionMonitor(persist_s=1.0)
    t, warns = 0.0, 0
    for _ in range(int(0.8 * FPS)):
        t += DT
        warns += m.update(t, True).warn
    assert warns == 0 and not m.active
    for _ in range(int(0.5 * FPS)):
        t += DT
        warns += m.update(t, True).warn
    assert warns == 1 and m.active


def test_obstruction_no_repeat_while_present_and_cooldown():
    m = ObstructionMonitor(persist_s=1.0, clear_s=1.5, cooldown_s=20.0)
    t, warns, clears = 0.0, 0, 0

    def step(seconds, present):
        nonlocal t, warns, clears
        for _ in range(int(round(seconds * FPS))):
            t += DT
            u = m.update(t, present)
            warns += u.warn
            clears += u.cleared

    step(8.0, True)  # chair stays: one warning only
    assert warns == 1
    step(2.0, False)  # removed: clears
    assert clears == 1 and not m.active
    step(2.0, True)  # back within cooldown: active again, silently
    assert m.active and warns == 1
    step(2.0, False)
    step(8.0, False)  # cooldown (20 s since the first warning) elapsed
    step(2.0, True)
    assert warns == 2


def test_overlap_fraction():
    region = (0.25, 0.5, 0.75, 1.0)
    assert overlap_fraction((0.3, 0.6, 0.5, 0.9), region) == 1.0
    assert overlap_fraction((0.0, 0.0, 0.2, 0.2), region) == 0.0
    assert 0.4 < overlap_fraction((0.0, 0.5, 0.5, 1.0), region) < 0.6


def test_snapshot_is_blurred_before_write():
    rng = np.random.default_rng(0)
    frame = rng.integers(0, 255, (240, 320, 3), dtype=np.uint8)  # high-detail source
    import cv2

    data = blur_full_frame(frame)
    out = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    sharp = cv2.Laplacian(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var()
    blurred = cv2.Laplacian(cv2.cvtColor(out, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var()
    assert out.shape == frame.shape
    assert blurred < sharp * 0.01

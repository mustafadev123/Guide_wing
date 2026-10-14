// Readiness and failure announcements with hysteresis.
// A raw signal (derived from backend health: fresh camera frames + model readiness, or a fresh
// snapshot) must hold steady for a while before it counts, so brief flickers do not cause chatter.

export interface Transition<T> { from: T | null; to: T }

export class StableSignal<T extends string> {
  private stable: T | null = null;
  private candidate: T | null = null;
  private since = 0;

  /** hold(to, from): how long `to` must persist before it replaces `from` (from = null initially). */
  constructor(private hold: (to: T, from: T | null) => number) {}

  get value() { return this.stable; }

  update(raw: T, now: number): Transition<T> | null {
    if (raw === this.stable) { this.candidate = null; return null; }
    if (raw !== this.candidate) { this.candidate = raw; this.since = now; }
    if (now - this.since < this.hold(raw, this.stable)) return null;
    const t = { from: this.stable, to: raw };
    this.stable = raw; this.candidate = null;
    return t;
  }
}

export type CameraSignal = "starting" | "ready-live" | "ready-replay" | "ready-test" | "unavailable";

/**
 * Backend vision status -> camera signal. `ready` is true only with a fresh frame (< 2 s old) and a
 * loaded model; a stale frame or capture failure comes with an error. A configured camera that has not
 * produced its first frame yet (no error) is "starting", which is never announced.
 */
export function cameraSignal(v: { input_mode: string; ready: boolean; error: string | null }): CameraSignal {
  if (!v.ready) return (v.input_mode === "live" || v.input_mode === "replay") && !v.error ? "starting" : "unavailable";
  return v.input_mode === "live" ? "ready-live" : v.input_mode === "replay" ? "ready-replay" : v.input_mode === "test" ? "ready-test" : "unavailable";
}

export const CAMERA_HOLD_MS = { initial: 1500, failure: 3000, recovery: 3000 };
export const cameraHold = (to: CameraSignal, from: CameraSignal | null) =>
  from === null ? CAMERA_HOLD_MS.initial : to === "unavailable" ? CAMERA_HOLD_MS.failure : CAMERA_HOLD_MS.recovery;

/** Never claims the path is safe: readiness only describes what input is running. */
export function cameraMessage(t: Transition<CameraSignal>): string | null {
  const again = t.from === "unavailable" ? " again" : "";
  switch (t.to) {
    case "ready-live": return `Camera ready${again}. Live chair and open-palm recognition is running.`;
    case "ready-replay": return `Replay input ready${again}. Recognition is running on recorded video, not a live camera.`;
    case "ready-test": return "Test input mode. No camera is connected; only developer test observations are used.";
    case "unavailable": return "Camera unavailable. You can still request help.";
    case "starting": return null;
  }
}

export type ServerSignal = "up" | "down";
export const SERVER_HOLD_MS = { down: 2000, up: 3000 };
export const serverHold = (to: ServerSignal, from: ServerSignal | null) =>
  from === null ? 0 : to === "down" ? SERVER_HOLD_MS.down : SERVER_HOLD_MS.up;
export const SERVER_DOWN_MESSAGE =
  "Connection to the GuideWing server lost. Help requests and cancellations cannot be confirmed right now. If you need help urgently, use another way to get it.";

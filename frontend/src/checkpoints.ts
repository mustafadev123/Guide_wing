// Spoken checkpoints on the simulated demo route.
// The backend owns progress: Journey.waypoint_index is the last route waypoint whose boundary
// (cumulative fraction in the route definition) has been passed. This never uses a frontend timer or
// the nearest-landmark label. Purely informational: no directions, traffic or safe-path claims.

export interface CheckpointJourney {
  id: string;
  status: "idle" | "active" | "paused" | "ended";
  waypoint_index: number | null;
  route_progress: number;
}

export interface Checkpoint { key: string; text: string }

export class CheckpointTracker {
  private journeyId: string | null = null;
  private reached = 0;

  /** names: waypoint names in route order (from /api/simulation/route); may be empty until loaded. */
  constructor(private names: () => string[]) {}

  /**
   * Returns an announcement when the journey has crossed one or more checkpoint boundaries since the
   * last observation. The first observation of any journey (page load, reconnect, new journey) only
   * records the current position, so old checkpoints are never replayed.
   */
  observe(j: CheckpointJourney, fallbackName: string | null = null): Checkpoint | null {
    const index = j.waypoint_index ?? 0;
    if (j.id !== this.journeyId) { this.journeyId = j.id; this.reached = index; return null; }
    if (index <= this.reached) return null;
    const from = this.reached + 1;
    this.reached = index;
    if (j.status !== "active") return null; // paused/ended: the moment has passed; nothing is queued
    const names = this.names();
    const last = names.length - 1;
    // The final waypoint is covered by the existing "end of the demo route" message.
    const crossed = range(from, index).filter(i => !(i === last && j.route_progress >= 1));
    if (!crossed.length) return null;
    const label = (i: number) => names[i] ?? (i === index ? fallbackName : null);
    const named = crossed.map(label).filter((n): n is string => !!n);
    if (!named.length) return null;
    const final = named[named.length - 1];
    const passed = named.slice(0, -1);
    const text = passed.length
      ? `You've passed ${passed.join(" and ")} and reached ${final} on the simulated route.`
      : `You've reached ${final} on the simulated route.`;
    return { key: `checkpoint:${j.id}:${index}`, text };
  }
}

function range(a: number, b: number) { return Array.from({ length: Math.max(0, b - a + 1) }, (_, k) => a + k); }

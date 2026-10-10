// Minimal 2D fallback renderer. Reads the same /api/simulation/state snapshot as Unreal,
// polls about twice per second with one request in flight, and only interpolates visually.
// It never advances the route or writes position.

import { useEffect, useRef, useState } from "react";
import { api, describeLocation, RouteInfo, SimulationState } from "../api";
import { usePolling } from "../events";
import { ModeBadge } from "../components";

const W = 640;
const H = 360;
const PAD = 40;

function project(route: RouteInfo) {
  const pts = route.waypoints;
  const hasCoords = pts.every((p) => p.latitude !== null && p.longitude !== null);
  if (!hasCoords) {
    return pts.map((p, i) => ({ ...p, x: PAD + (i / (pts.length - 1)) * (W - 2 * PAD), y: H / 2 }));
  }
  const lats = pts.map((p) => p.latitude as number);
  const lons = pts.map((p) => p.longitude as number);
  const [minLat, maxLat, minLon, maxLon] = [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)];
  const sx = (W - 2 * PAD) / Math.max(1e-9, maxLon - minLon);
  const sy = (H - 2 * PAD) / Math.max(1e-9, maxLat - minLat);
  const s = Math.min(sx, sy);
  return pts.map((p) => ({
    ...p,
    x: PAD + ((p.longitude as number) - minLon) * s,
    y: H - PAD - ((p.latitude as number) - minLat) * s,
  }));
}

function pointAt(points: ReturnType<typeof project>, progress: number) {
  const p = Math.min(1, Math.max(0, progress));
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (p <= b.progress) {
      const f = (p - a.progress) / Math.max(1e-9, b.progress - a.progress);
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
  }
  const last = points[points.length - 1];
  return { x: last.x, y: last.y };
}

export function SimPage() {
  const [route, setRoute] = useState<RouteInfo | null>(null);
  const snap = usePolling<SimulationState>(() => api.snapshot(), 500);
  const [shown, setShown] = useState(0);
  const target = useRef({ progress: 0, at: 0, moving: false, rate: 0 });
  const lastRevision = useRef<{ boot: string; rev: number } | null>(null);
  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    api.route().then(setRoute).catch(() => setRoute(null));
  }, []);

  const s = snap.data;
  useEffect(() => {
    if (!s || !route) return;
    const prev = lastRevision.current;
    if (prev && prev.boot === s.boot_id && s.revision < prev.rev) return; // discard older revision
    lastRevision.current = { boot: s.boot_id, rev: s.revision };
    target.current = {
      progress: s.journey.route_progress,
      at: performance.now(),
      moving: s.journey.status === "active",
      rate: 1 / route.duration_s,
    };
  }, [s, route]);

  // Visual interpolation only: extrapolate up to one poll interval while active.
  useEffect(() => {
    let raf = 0;
    const frame = () => {
      const t = target.current;
      const ahead = t.moving && !reduced ? Math.min(0.5, (performance.now() - t.at) / 1000) * t.rate : 0;
      setShown(Math.min(1, t.progress + ahead));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  const stale = snap.lastOk !== null && Date.now() - snap.lastOk > 3000;
  const points = route ? project(route) : [];
  const pos = points.length ? pointAt(points, shown) : null;
  const inc = s?.active_incident;

  return (
    <main className="page sim">
      <header className="topbar">
        <h1>GuideWing <span className="sub">2D fallback view</span></h1>
        {s && <ModeBadge mode={s.vision.input_mode} ready={s.vision.ready} />}
      </header>
      <p className="notice">
        Simulated journey — fallback renderer. Unreal is the primary renderer; both read the same backend state.
        Positions are configured demo waypoints, not real GPS.
      </p>
      {(snap.error || stale) && (
        <p className="error" role="alert">Disconnected from the backend — the scene is stopped until fresh state arrives.</p>
      )}
      <div className="sim-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby="sim-desc" className="sim-svg">
          <title id="sim-desc">
            {s ? `Companion at ${Math.round(s.journey.route_progress * 100)} percent of the simulated route, ${s.journey.status}.` : "Loading route"}
          </title>
          <polyline points={points.map((p) => `${p.x},${p.y}`).join(" ")} className="route-line" />
          {points.map((p) => (
            <g key={p.name}>
              <circle cx={p.x} cy={p.y} r={7} className="waypoint" />
              <text x={p.x + 10} y={p.y - 10} className="wp-label">{p.name}</text>
            </g>
          ))}
          {pos && (
            <g transform={`translate(${pos.x},${pos.y})`}>
              <circle r={13} className={`walker ${s?.journey.status ?? ""}`} />
              <text y={5} textAnchor="middle" className="walker-label">U</text>
              <g transform="translate(0,-30)">
                <rect x={-14} y={-7} width={28} height={14} rx={4} className={`drone ${inc ? `s-${inc.status}` : ""}`} />
                <text y={4} textAnchor="middle" className="drone-label">D</text>
              </g>
            </g>
          )}
        </svg>
      </div>
      {s && (
        <dl className="facts card">
          <dt>Journey</dt>
          <dd>{s.journey.status}{s.journey.pause_reason ? ` (paused: ${s.journey.pause_reason.replace("_", " ")})` : ""}, {Math.round(s.journey.route_progress * 100)}%</dd>
          <dt>Location</dt>
          <dd>{describeLocation(s.journey.location)}</dd>
          <dt>Help request</dt>
          <dd>{inc ? inc.status : "none"}</dd>
          <dt>Obstruction</dt>
          <dd>{s.vision.obstruction_active ? "detected in monitored region" : "none detected"}</dd>
          <dt>Revision</dt>
          <dd>{s.revision} (boot {s.boot_id.slice(0, 8)})</dd>
        </dl>
      )}
      <p className="hint">Legend: U = participant, D = companion drone. Text above is the authoritative state.</p>
    </main>
  );
}

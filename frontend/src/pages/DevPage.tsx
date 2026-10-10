// Developer controls. Everything here is labeled TEST and is never presented as live detection.

import { useState } from "react";
import { api, ApiError, VisionStatus } from "../api";
import { usePolling } from "../events";

const MOCKS = ["active", "paused", "obstacle", "pending", "dispatched", "acknowledged", "cancelled", "resolved", "no-location"];

export function DevPage() {
  const vision = usePolling<VisionStatus>(api.vision, 1000);
  const [log, setLog] = useState<string>("");

  const run = async (label: string, fn: () => Promise<unknown>) => {
    try {
      const r = await fn();
      setLog(`${label}: ${JSON.stringify(r)}`);
    } catch (e) {
      setLog(`${label} failed: ${e instanceof ApiError ? e.message : String(e)}`);
    }
  };

  return (
    <main className="page dev">
      <header className="topbar">
        <h1>GuideWing <span className="sub">developer controls</span></h1>
        <span className="badge mode-test">TEST CONTROLS</span>
      </header>
      <p className="notice">
        These controls inject TEST observations. They are labeled as test everywhere and are not computer-vision results.
      </p>

      <section className="card" aria-labelledby="demo-h">
        <h2 id="demo-h">Demo</h2>
        <div className="controls">
          <button className="btn" onClick={() => run("reset", api.devReset)}>Reset demo (new idle journey)</button>
        </div>
      </section>

      <section className="card" aria-labelledby="inj-h">
        <h2 id="inj-h">Inject TEST observations</h2>
        <div className="controls">
          <button className="btn" onClick={() => run("test obstruction", () => api.devVision("obstruction"))}>TEST obstruction</button>
          <button className="btn" onClick={() => run("test clear", () => api.devVision("clear"))}>TEST clear obstruction</button>
          <button className="btn" onClick={() => run("test palm", () => api.devVision("palm"))}>TEST palm-hold request</button>
        </div>
        <p role="status" className="message mono">{log}</p>
      </section>

      <section className="card" aria-labelledby="mock-h">
        <h2 id="mock-h">Mock Unreal snapshots (data_source = mock)</h2>
        <ul>
          {MOCKS.map((m) => (
            <li key={m}>
              <a href={`/api/simulation/state?journey_id=mock-${m}`}>mock-{m}</a>
            </li>
          ))}
          <li>
            <a href="/api/simulation/state?journey_id=current">current live journey</a>
          </li>
        </ul>
      </section>

      <section className="card" aria-labelledby="vis-h">
        <h2 id="vis-h">Vision status</h2>
        <pre className="mono">{vision.data ? JSON.stringify(vision.data, null, 2) : vision.error ?? "loading"}</pre>
        {vision.data && (vision.data.input_mode === "live" || vision.data.input_mode === "replay") && (
          <img className="preview" src="/api/vision/stream" alt="Annotated camera preview" />
        )}
      </section>
    </main>
  );
}

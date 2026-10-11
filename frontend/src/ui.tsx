import { useEffect, useState } from "react";

export function Icon({ name }: { name: "help" | "cancel" | "repeat" | "arrow" | "pause" | "play" | "drone" }) {
  const paths = { help: <><path d="M7 17 17 7M7 7h10v10" /></>, cancel: <path d="m7 7 10 10M17 7 7 17" />, repeat: <><path d="M5 8a8 8 0 1 1-1 7M5 3v5h5" /></>, arrow: <path d="m7 17 10-10M7 7h10v10" />, pause: <><path d="M8 5v14M16 5v14" /></>, play: <path d="m8 5 11 7-11 7Z" />, drone: <><rect x="9" y="8" width="6" height="8" rx="2" /><path d="m9 9-4-4m10 4 4-4M9 15l-4 4m10-4 4 4" /><ellipse cx="4" cy="4" rx="3" ry="2" /><ellipse cx="20" cy="4" rx="3" ry="2" /><ellipse cx="4" cy="20" rx="3" ry="2" /><ellipse cx="20" cy="20" rx="3" ry="2" /></> };
  return <svg className={`icon icon-${name}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function Brand() {
  return <a className="brand" href="/user" aria-label="Guide Wing home"><Icon name="drone" /><span>Guide Wing</span></a>;
}

export function ViewHeader({ current }: { current: "responder" | "sim" }) {
  return <header className="site-header"><div className="header-inner"><Brand /><nav aria-label="Views"><a href="/user">Home</a><a href="/responder" aria-current={current === "responder" ? "page" : undefined}>Responder</a><a href="/sim" aria-current={current === "sim" ? "page" : undefined}>Simulation</a></nav></div></header>;
}

export function Atmosphere() {
  return <div className="atmosphere" aria-hidden="true"><svg viewBox="0 0 600 280" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="mist" x2="1" y2="1"><stop stopColor="#415950" stopOpacity=".5" /><stop offset="1" stopColor="#1b2824" stopOpacity=".2" /></linearGradient></defs><path fill="url(#mist)" d="M-60 130Q140-30 390 130T700 160V350H-60Z" /><path fill="#385148" opacity=".18" d="M90 330Q370 35 650 5V330Z" />{[0, 1, 2, 3, 4, 5].map(n => <path key={n} d={`M35 ${240 + n * 13} Q145 ${64 + n * 19} 295 ${172 + n * 10} T570 ${38 + n * 12}`} fill="none" stroke="#8fc1ae" strokeOpacity=".22" strokeWidth=".8" />)}</svg><span>A clearer moment</span></div>;
}

/** Decoration is separate from readiness and never intercepts assistance controls. */
export function Entrance({ ready, error, retry }: { ready: boolean; error: string | null; retry: () => void }) {
  const [done, setDone] = useState(false);
  const [closed, setClosed] = useState(false);
  const [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(query.matches);
    query.addEventListener("change", change);
    const timer = window.setTimeout(() => setDone(true), 1900);
    return () => { clearTimeout(timer); query.removeEventListener("change", change); };
  }, []);
  useEffect(() => {
    if (!ready || (!done && !reduced)) return;
    const timer = window.setTimeout(() => setClosed(true), reduced ? 0 : 220);
    return () => clearTimeout(timer);
  }, [ready, done, reduced]);
  if (closed) return null;
  return <div className={`entrance ${ready ? "ready" : ""} ${done || reduced ? "static" : ""} ${ready && (done || reduced) ? "leaving" : ""}`}>
    {!done && !reduced && <div className="flyby" aria-hidden="true"><span className="drone-shadow" /><svg viewBox="0 0 140 60"><defs><linearGradient id="drone-metal" x2="0" y2="1"><stop stopColor="#d7eee4" /><stop offset="1" stopColor="#53786b" /></linearGradient></defs><path d="m42 25 19 7m38-7-19 7M44 43l18-8m34 8-17-8" stroke="#73988a" strokeWidth="5" /><g fill="none" stroke="#b3d9c8" strokeWidth="2"><ellipse cx="34" cy="23" rx="24" ry="4" /><ellipse cx="106" cy="23" rx="24" ry="4" /><ellipse cx="38" cy="44" rx="21" ry="3" /><ellipse cx="102" cy="44" rx="21" ry="3" /></g><path d="M53 29Q70 19 87 29L83 42Q70 49 57 42Z" fill="url(#drone-metal)" /><circle cx="70" cy="40" r="2" fill="#b9f3dc" /></svg></div>}
    <div className="launch-label"><strong>Guide Wing</strong><span role="status">{error ? "Connection unavailable. Your journey has not been changed." : ready ? "Journey connected" : "Connecting to your journey…"}</span>{!done && !reduced && <button className="text-button" onClick={() => setDone(true)}>Skip animation</button>}{error && <button className="btn" onClick={retry}>Retry connection</button>}</div>
  </div>;
}

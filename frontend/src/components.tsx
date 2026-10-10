import { InputMode, MODE_LABEL } from "./api";
import { Connection } from "./events";

export function ConnectionBadge({ connection, error }: { connection: Connection; error: string | null }) {
  const lost = connection !== "connected" || !!error;
  return (
    <span className={`badge ${lost ? "badge-bad" : "badge-ok"}`}>
      {error ? "Server unreachable" : connection === "connected" ? "Connected" : "Reconnecting…"}
    </span>
  );
}

export function ModeBadge({ mode, ready }: { mode: InputMode; ready: boolean }) {
  return (
    <span className={`badge mode-${mode}`} title="Camera input mode">
      {MODE_LABEL[mode]}
      {mode !== "unavailable" && !ready ? " (not ready)" : ""}
    </span>
  );
}

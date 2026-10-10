import { useId, useRef, useState } from "react";
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

/** Read-only, selectable ID with a Copy button. Works on plain-HTTP LAN pages too
 *  (navigator.clipboard needs a secure context; falls back to select + execCommand). */
export function CopyableId({ label, value, hint }: { label: string; value: string | null; hint?: string }) {
  const [status, setStatus] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();

  const copy = async () => {
    if (!value) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
      } else {
        inputRef.current?.select();
        if (!document.execCommand("copy")) throw new Error("copy blocked");
      }
      setStatus("Copied.");
    } catch {
      inputRef.current?.select();
      setStatus("Copy blocked by the browser. The ID is selected; press Ctrl+C.");
    }
  };

  return (
    <div className="copy-id">
      <label htmlFor={id}>{label}</label>
      <div className="copy-row">
        <input id={id} ref={inputRef} readOnly value={value ?? "loading…"} className="mono id-field" onFocus={(e) => e.currentTarget.select()} />
        <button className="btn" onClick={copy} disabled={!value}>
          Copy
        </button>
      </div>
      {hint && <p className="hint">{hint}</p>}
      <p role="status" aria-live="polite" className="hint">{status}</p>
    </div>
  );
}

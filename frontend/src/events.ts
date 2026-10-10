// Live updates over /ws/events with reconnection. Any reconnect, boot change or
// sequence gap triggers onResync so the page re-reads authoritative REST state.

import { useEffect, useRef, useState } from "react";

export interface ServerEvent {
  boot_id: string;
  sequence: number;
  type: string;
  occurred_at: string;
  payload: Record<string, unknown>;
}

export type Connection = "connecting" | "connected" | "reconnecting";

export function useServerEvents(onEvent: (e: ServerEvent) => void, onResync: () => void): Connection {
  const [state, setState] = useState<Connection>("connecting");
  const handlers = useRef({ onEvent, onResync });
  handlers.current = { onEvent, onResync };

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let retry = 0;
    let timer: number | undefined;
    let boot: string | null = null;
    let lastSeq = 0;

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/ws/events`);
      ws.onmessage = (msg) => {
        const e = JSON.parse(msg.data) as ServerEvent;
        if (e.type === "hello") {
          setState("connected");
          retry = 0;
          boot = e.boot_id;
          lastSeq = e.sequence;
          handlers.current.onResync();
          return;
        }
        if (e.type === "ping") return;
        if (e.boot_id !== boot || e.sequence !== lastSeq + 1) {
          boot = e.boot_id;
          handlers.current.onResync();
        }
        lastSeq = e.sequence;
        handlers.current.onEvent(e);
      };
      ws.onclose = () => {
        if (closed) return;
        setState("reconnecting");
        retry = Math.min(retry + 1, 5);
        timer = window.setTimeout(connect, 500 * retry);
      };
    };
    connect();
    return () => {
      closed = true;
      window.clearTimeout(timer);
      ws?.close();
    };
  }, []);

  return state;
}

/** Poll a REST endpoint with at most one request in flight (same pattern Unreal uses). */
export function usePolling<T>(fetcher: () => Promise<T>, intervalMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastOk, setLastOk] = useState<number | null>(null);
  const inFlight = useRef(false);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;

  const refresh = useRef(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const d = await fetchRef.current();
      setData(d);
      setError(null);
      setLastOk(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlight.current = false;
    }
  }).current;

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs, refresh]);

  return { data, error, lastOk, refresh };
}

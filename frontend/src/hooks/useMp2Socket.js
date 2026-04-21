import { useEffect, useRef, useState, useCallback } from "react";

const BACKEND_BASE = process.env.REACT_APP_BACKEND_URL || "";
const WS_BASE = BACKEND_BASE
  ? BACKEND_BASE.replace(/^https/, "wss").replace(/^http/, "ws")
  : `ws://${window.location.host}`;

/**
 * Lightweight WebSocket client for MP2 sessions.
 *
 * The MP2 backend is the source of truth — the frontend doesn't hold a
 * duplicated game state. This hook just subscribes to the session WS and
 * fires `onEvent(event, data)` for every push. Callers typically respond
 * by refetching whatever solo endpoint they care about (the middleware
 * auto-routes it to the session).
 *
 * Features:
 *   - auto-reconnect with exponential backoff (capped at 10s)
 *   - heartbeat: responds to server `ping` with `pong`
 *   - clean teardown on unmount (no leaks)
 *   - no-op when sid/token are null (solo mode)
 *
 * @param {string|null} sid
 * @param {string|null} token
 * @param {(event: string, data: unknown) => void} onEvent
 * @returns {{ connected: boolean, send: (msg: object) => void, peers: string[] }}
 */
export function useMp2Socket(sid, token, onEvent) {
  const [connected, setConnected] = useState(false);
  const [peers, setPeers] = useState([]);
  const wsRef = useRef(null);
  const onEventRef = useRef(onEvent);
  const mountedRef = useRef(true);
  const reconnectRef = useRef(null);
  const attemptsRef = useRef(0);

  // Keep the latest onEvent without forcing reconnect when parent re-renders.
  useEffect(() => { onEventRef.current = onEvent; }, [onEvent]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const connect = useCallback(() => {
    if (!sid || !token) return;
    const url = `${WS_BASE}/ws/mp2/${encodeURIComponent(sid)}?token=${encodeURIComponent(token)}`;
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      // Malformed URL or browser blocks WS — schedule retry.
      scheduleReconnect();
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      attemptsRef.current = 0;
      setConnected(true);
    };

    ws.onmessage = (ev) => {
      if (!mountedRef.current) return;
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      const { event, data } = msg || {};

      // Built-in handlers before forwarding
      if (event === "ping") {
        try { ws.send(JSON.stringify({ type: "pong" })); } catch { /* socket closing */ }
        return;
      }
      if (event === "hello") {
        const names = (data?.players || [])
          .map((p) => p.username)
          .filter(Boolean);
        setPeers(names);
      } else if (event === "peer_joined" && data?.username) {
        setPeers((prev) => prev.includes(data.username) ? prev : [...prev, data.username]);
      } else if (event === "peer_left" && data?.username) {
        setPeers((prev) => prev.filter((n) => n !== data.username));
      }

      try { onEventRef.current?.(event, data); } catch (e) {
        // Swallow handler errors to keep the socket alive.
        // eslint-disable-next-line no-console
        console.error("[useMp2Socket] onEvent threw:", e);
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setConnected(false);
      scheduleReconnect();
    };

    ws.onerror = () => { /* rely on onclose to schedule retry */ };
  }, [sid, token]);

  const scheduleReconnect = useCallback(() => {
    if (!mountedRef.current) return;
    if (reconnectRef.current) return;
    const attempt = attemptsRef.current + 1;
    attemptsRef.current = attempt;
    const delay = Math.min(1000 * 2 ** (attempt - 1), 10_000);
    reconnectRef.current = setTimeout(() => {
      reconnectRef.current = null;
      if (mountedRef.current) connect();
    }, delay);
  }, [connect]);

  useEffect(() => {
    if (!sid || !token) {
      setConnected(false);
      setPeers([]);
      return () => {};
    }
    connect();
    return () => {
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current);
        reconnectRef.current = null;
      }
      if (wsRef.current) {
        try { wsRef.current.close(); } catch { /* ignore */ }
        wsRef.current = null;
      }
    };
  }, [sid, token, connect]);

  const send = useCallback((msg) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try { ws.send(JSON.stringify(msg)); return true; } catch { return false; }
  }, []);

  return { connected, send, peers };
}

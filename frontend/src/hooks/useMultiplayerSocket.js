import { useState, useEffect, useRef, useCallback } from "react";

const BACKEND_BASE = process.env.REACT_APP_BACKEND_URL || "";
const WS_BASE = BACKEND_BASE
  ? BACKEND_BASE.replace(/^http/, "ws")
  : `ws://${window.location.hostname}:8000`;

/**
 * Hook WebSocket pour une session multijoueur.
 *
 * @param {string|null} sessionId
 * @param {string|null} token
 * @returns {{ state, connected, error, sendMessage, sendChat }}
 */
export function useMultiplayerSocket(sessionId, token) {
  const [state, setState] = useState(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);
  const mountedRef = useRef(true);
  const attemptsRef = useRef(0);

  const connect = useCallback(() => {
    if (!sessionId || !token) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const url = `${WS_BASE}/ws/mp/${sessionId}?token=${token}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setConnected(true);
      setError(null);
      attemptsRef.current = 0;
    };

    ws.onmessage = (evt) => {
      if (!mountedRef.current) return;
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === "state_update") {
          setState(msg.payload);
        }
        // Other event types handled externally if needed
      } catch {
        // ignore malformed frames
      }
    };

    ws.onerror = () => {
      if (!mountedRef.current) return;
      setConnected(false);
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setConnected(false);
      wsRef.current = null;

      // Exponential backoff reconnect (max 30s)
      const delay = Math.min(1000 * 2 ** attemptsRef.current, 30000);
      attemptsRef.current += 1;
      reconnectTimer.current = setTimeout(connect, delay);
    };
  }, [sessionId, token]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  const sendMessage = useCallback((type, payload = {}) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, payload }));
    }
  }, []);

  const sendChat = useCallback((text) => {
    sendMessage("chat", { text });
  }, [sendMessage]);

  return { state, connected, error, sendMessage, sendChat };
}

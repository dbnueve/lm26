import { useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";

const BACKEND_BASE = process.env.REACT_APP_BACKEND_URL || "";

// WS base : si REACT_APP_BACKEND_URL est défini (ex: http://100.x.x.x:8000)
// on le convertit en ws://. Sinon on utilise le même hostname que la page.
const WS_BASE = BACKEND_BASE
  ? BACKEND_BASE.replace(/^https/, "wss").replace(/^http/, "ws")
  : `ws://${window.location.hostname}:8000`;

const HTTP_BASE = BACKEND_BASE || "";

/**
 * Hook WebSocket pour une session multijoueur avec polling HTTP de fallback.
 *
 * - Tente une connexion WebSocket en priorité
 * - Si le WS échoue/ferme → polling HTTP toutes les 2.5s
 * - Quand le WS se reconnecte → arrête le polling
 * - Un seul fetch initial HTTP en parallèle du connect() pour afficher l'état
 *   rapidement, mais le polling récurrent ne démarre que si le WS échoue.
 *
 * @returns {{ state, connected, wsOk, error, sendMessage, sendChat, refetch }}
 */
export function useMultiplayerSocket(sessionId, token) {
  const [state, setState] = useState(null);
  const [connected, setConnected] = useState(false);
  const [wsOk, setWsOk] = useState(false);
  const [error, setError] = useState(null);

  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);
  const pollTimer = useRef(null);
  const mountedRef = useRef(true);
  const attemptsRef = useRef(0);
  const abortRef = useRef(null);

  // ── HTTP polling fallback ──────────────────────────────────────────────────
  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const fetchState = useCallback(async () => {
    if (!sessionId || !token) return;
    // Annuler toute requête précédente en vol
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await axios.get(
        `${HTTP_BASE}/api/mp/${sessionId}/state`,
        { params: { token }, timeout: 5000, signal: ctrl.signal }
      );
      if (mountedRef.current) {
        setState(res.data);
        setError(null);
      }
    } catch (e) {
      if (!mountedRef.current) return;
      if (axios.isCancel?.(e) || e?.name === "CanceledError") return;
      const status = e?.response?.status;
      if (status === 404 || status === 401) {
        localStorage.removeItem("mp_session");
        setError("Session expirée. Recrée ou rejoins une partie.");
        stopPolling();
      } else {
        setError(e?.response?.data?.detail || "Erreur de connexion");
      }
    }
  }, [sessionId, token, stopPolling]);

  const startPolling = useCallback(() => {
    if (pollTimer.current) return;
    fetchState();
    pollTimer.current = setInterval(fetchState, 2500);
  }, [fetchState]);

  // ── WebSocket ──────────────────────────────────────────────────────────────
  const connect = useCallback(() => {
    if (!sessionId || !token) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const url = `${WS_BASE}/ws/mp/${sessionId}?token=${token}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;
        setConnected(true);
        setWsOk(true);
        setError(null);
        attemptsRef.current = 0;
        stopPolling();
      };

      ws.onmessage = (evt) => {
        if (!mountedRef.current) return;
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === "state_update") {
            setState(msg.payload);
          } else if (msg.type === "ping") {
            // Le serveur nous teste — répondre par pong pour rester vivants
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ type: "pong" }));
            }
          }
        } catch {
          // ignore frames malformées
        }
      };

      ws.onerror = () => {
        if (!mountedRef.current) return;
        setWsOk(false);
        startPolling();
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        setConnected(false);
        setWsOk(false);
        wsRef.current = null;

        startPolling();

        // Reconnexion exponentielle avec jitter (évite thundering herd)
        const base = Math.min(1000 * 2 ** attemptsRef.current, 30000);
        const jitter = Math.random() * 1000;
        const delay = base + jitter;
        attemptsRef.current += 1;
        reconnectTimer.current = setTimeout(connect, delay);
      };
    } catch {
      setWsOk(false);
      startPolling();
    }
  }, [sessionId, token, startPolling, stopPolling]);

  useEffect(() => {
    mountedRef.current = true;
    // Un seul fetch initial pour afficher l'état vite,
    // le polling récurrent ne démarre que si le WS échoue (via onerror/onclose).
    fetchState();
    connect();

    return () => {
      mountedRef.current = false;
      clearTimeout(reconnectTimer.current);
      clearInterval(pollTimer.current);
      pollTimer.current = null;
      if (abortRef.current) abortRef.current.abort();
      abortRef.current = null;
      if (wsRef.current) {
        // Neutraliser les callbacks avant close pour éviter re-connect post-unmount
        wsRef.current.onopen = null;
        wsRef.current.onmessage = null;
        wsRef.current.onerror = null;
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
      wsRef.current = null;
    };
  }, [connect, fetchState]);

  useEffect(() => {
    if (!wsOk && state) setConnected(true);
  }, [wsOk, state]);

  const sendMessage = useCallback((type, payload = {}) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, payload }));
    }
  }, []);

  const sendChat = useCallback((text) => {
    sendMessage("chat", { text });
  }, [sendMessage]);

  return { state, connected, wsOk, error, sendMessage, sendChat, refetch: fetchState };
}

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
 * - Si le WS échoue ou est déconnecté → polling HTTP toutes les 2.5s
 * - Quand le WS se reconnecte → arrête le polling
 *
 * @returns {{ state, connected, wsOk, error, sendMessage, sendChat }}
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

  // ── HTTP polling fallback ──────────────────────────────────────────────────
  const fetchState = useCallback(async () => {
    if (!sessionId || !token) return;
    try {
      const res = await axios.get(
        `${HTTP_BASE}/api/mp/${sessionId}/state`,
        { params: { token }, timeout: 5000 }
      );
      if (mountedRef.current) {
        setState(res.data);
        setError(null);
      }
    } catch (e) {
      if (!mountedRef.current) return;
      const status = e?.response?.status;
      if (status === 404 || status === 401) {
        // Session expirée ou token invalide → nettoyer localStorage
        localStorage.removeItem("mp_session");
        setError("Session expirée. Recrée ou rejoins une partie.");
        stopPolling();
      } else {
        setError(e?.response?.data?.detail || "Erreur de connexion");
      }
    }
  }, [sessionId, token, stopPolling]);

  const startPolling = useCallback(() => {
    if (pollTimer.current) return; // already polling
    fetchState();
    pollTimer.current = setInterval(fetchState, 2500);
  }, [fetchState]);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

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
        stopPolling(); // WS connecté → plus besoin du polling
      };

      ws.onmessage = (evt) => {
        if (!mountedRef.current) return;
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === "state_update") {
            setState(msg.payload);
          }
        } catch {
          // ignore malformed frames
        }
      };

      ws.onerror = () => {
        if (!mountedRef.current) return;
        setWsOk(false);
        // Démarre le polling en fallback immédiatement
        startPolling();
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        setConnected(false);
        setWsOk(false);
        wsRef.current = null;

        // Polling de secours pendant la reconnexion
        startPolling();

        // Reconnexion exponentielle (max 30s)
        const delay = Math.min(1000 * 2 ** attemptsRef.current, 30000);
        attemptsRef.current += 1;
        reconnectTimer.current = setTimeout(connect, delay);
      };
    } catch {
      // WebSocket non supporté ou URL invalide → polling seul
      setWsOk(false);
      startPolling();
    }
  }, [sessionId, token, startPolling, stopPolling]);

  useEffect(() => {
    mountedRef.current = true;
    // Démarre le polling immédiatement pour l'état initial
    // (le WS prendra le relais quand il sera prêt)
    startPolling();
    connect();

    return () => {
      mountedRef.current = false;
      clearTimeout(reconnectTimer.current);
      clearInterval(pollTimer.current);
      pollTimer.current = null;
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect, startPolling]);

  // connected = WS ouvert OU polling actif avec état reçu
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

  return { state, connected, wsOk, error, sendMessage, sendChat };
}

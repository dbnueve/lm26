import React from "react";
import axios from "axios";

// Use relative URLs so the webpack devServer proxy routes /api/ to the FastAPI backend.
// This works whether the app is accessed via localhost or a cloud preview URL.
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "";
const API = BACKEND_URL + "/api";

// Context for lolesports player headshot URLs (name.toLowerCase() → url)
const PlayerImagesContext = React.createContext({});

// Convert 2-letter ISO country code to flag emoji
const toFlag = (code) => {
  if (!code || code.length !== 2) return code || "";
  const c = code.toUpperCase() === "UK" ? "GB" : code.toUpperCase();
  try { return String.fromCodePoint(...c.split('').map(ch => 0x1F1E6 + ch.charCodeAt(0) - 65)); }
  catch { return code; }
};

// Context for team logo URLs (teamId → url)
const TeamLogosContext = React.createContext({});
const TeamModalContext = React.createContext({ openTeam: () => {} });

// Format a money amount: >= 1 000 000 → "X.XM", otherwise → "XK"
const formatMoney = (amount) => {
  if (!amount && amount !== 0) return "0K";
  if (amount >= 1_000_000) return (amount / 1_000_000).toFixed(1) + "M";
  return Math.round(amount / 1000) + "K";
};

// ── MP2 session context ──────────────────────────────────────────────────────
// Null = solo mode. Any string = active MP2 session id. When set, every request
// made through `API_CLIENT` automatically includes `?session_id=X`, routing
// the call to the backend middleware that swaps GAME_STATE for that session.
const SessionContext = React.createContext({
  sid: null,
  code: null,
  token: null,
  username: null,
  setSession: () => {},
  clearSession: () => {},
});

// Module-level ref so the Axios interceptor (set up once) can read the current
// session without re-creating the instance on every provider render.
const _sessionRef = { sid: null, token: null };

const API_CLIENT = axios.create({ baseURL: API });
API_CLIENT.interceptors.request.use((config) => {
  if (_sessionRef.sid) {
    config.params = {
      ...(config.params || {}),
      session_id: _sessionRef.sid,
      // Inject the caller's token so the MP2 middleware can resolve
      // `user_team` from session.players[token] per-request.
      ...(_sessionRef.token ? { mp_token: _sessionRef.token } : {}),
    };
  }
  return config;
});

/**
 * Provider that wires a session id into API_CLIENT for all child components.
 * Usage:
 *   <SessionProvider>
 *     <App />
 *   </SessionProvider>
 */
function SessionProvider({ children }) {
  const [session, setSessionState] = React.useState(() => {
    try {
      const raw = window.localStorage.getItem("lm26.mp2.session");
      return raw ? JSON.parse(raw) : { sid: null, code: null, token: null, username: null };
    } catch {
      return { sid: null, code: null, token: null, username: null };
    }
  });

  const setSession = React.useCallback((next) => {
    const normalized = {
      sid: next?.sid || null,
      code: next?.code || null,
      token: next?.token || null,
      username: next?.username || null,
    };
    _sessionRef.sid = normalized.sid;
    _sessionRef.token = normalized.token;
    setSessionState(normalized);
    try {
      if (normalized.sid) {
        window.localStorage.setItem("lm26.mp2.session", JSON.stringify(normalized));
      } else {
        window.localStorage.removeItem("lm26.mp2.session");
      }
    } catch { /* ignore quota/SSR */ }
  }, []);

  const clearSession = React.useCallback(() => setSession(null), [setSession]);

  // Keep the ref in sync on mount/hydration so the first render's API calls
  // already carry the session id.
  React.useEffect(() => {
    _sessionRef.sid = session.sid;
    _sessionRef.token = session.token;
  }, [session.sid, session.token]);

  const value = React.useMemo(
    () => ({ ...session, setSession, clearSession }),
    [session, setSession, clearSession],
  );

  return React.createElement(SessionContext.Provider, { value }, children);
}

/** Convenience hook. Returns `{ sid, code, token, setSession, clearSession }`. */
const useSession = () => React.useContext(SessionContext);

export {
  BACKEND_URL, API, API_CLIENT,
  PlayerImagesContext, toFlag, TeamLogosContext, TeamModalContext, formatMoney,
  SessionContext, SessionProvider, useSession,
};
export { axios };
export const withTimeout = (promise, ms = 10000) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Request timeout")), ms)
    )
  ]);

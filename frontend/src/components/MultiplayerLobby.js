import React, { useState } from "react";
import { API } from "../shared";
import axios from "axios";

/**
 * MultiplayerLobby — create or join a multiplayer session.
 * Props:
 *   onSessionJoined(sessionId, token, side) → called once session is ready
 *   onBack() → go back to main menu
 */
export default function MultiplayerLobby({ onSessionJoined, onBack }) {
  const [tab, setTab] = useState("create"); // "create" | "join"
  const [league, setLeague] = useState("LEC");
  const [username, setUsername] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState(null); // {session_id, code, token}

  const LEAGUES = ["LEC", "LCS", "LCK", "LPL", "CBLOL"];

  const handleCreate = async () => {
    if (!username.trim()) { setError("Entrez votre pseudo"); return; }
    setError(null);
    setLoading(true);
    try {
      const res = await axios.post(API + "/multiplayer/create", {
        league,
        username: username.trim(),
      });
      setCreated(res.data);
    } catch (e) {
      setError(e?.response?.data?.detail || "Erreur lors de la création");
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async () => {
    if (!username.trim()) { setError("Entrez votre pseudo"); return; }
    if (!joinCode.trim()) { setError("Entrez le code de la partie"); return; }
    setError(null);
    setLoading(true);
    try {
      const res = await axios.post(API + "/multiplayer/join", {
        code: joinCode.trim().toUpperCase(),
        username: username.trim(),
      });
      onSessionJoined(res.data.session_id, res.data.token, 2);
    } catch (e) {
      setError(e?.response?.data?.detail || "Code invalide ou partie déjà complète");
    } finally {
      setLoading(false);
    }
  };

  // After creation, waiting for guest — show code to share
  if (created) {
    return (
      <div style={styles.overlay}>
        <div style={styles.card}>
          <h2 style={styles.title}>Partie créée !</h2>
          <p style={styles.sub}>Partage ce code à ton adversaire :</p>
          <div style={styles.codeBox}>{created.code}</div>
          <p style={styles.hint}>En attente du joueur 2…</p>
          <button
            style={styles.btnPrimary}
            onClick={() => onSessionJoined(created.session_id, created.token, 1)}
          >
            Continuer vers la sélection d&apos;équipe
          </button>
          <button style={styles.btnSecondary} onClick={onBack}>Annuler</button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.card}>
        <h2 style={styles.title}>Mode Multijoueur</h2>

        <div style={styles.tabs}>
          <button
            style={tab === "create" ? styles.tabActive : styles.tab}
            onClick={() => { setTab("create"); setError(null); }}
          >
            Créer une partie
          </button>
          <button
            style={tab === "join" ? styles.tabActive : styles.tab}
            onClick={() => { setTab("join"); setError(null); }}
          >
            Rejoindre
          </button>
        </div>

        <div style={styles.field}>
          <label style={styles.label}>Pseudo</label>
          <input
            style={styles.input}
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="Votre pseudo"
            maxLength={20}
          />
        </div>

        {tab === "create" && (
          <div style={styles.field}>
            <label style={styles.label}>Ligue</label>
            <select
              style={styles.input}
              value={league}
              onChange={e => setLeague(e.target.value)}
            >
              {LEAGUES.map(l => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </div>
        )}

        {tab === "join" && (
          <div style={styles.field}>
            <label style={styles.label}>Code de partie</label>
            <input
              style={{ ...styles.input, textTransform: "uppercase", letterSpacing: 4, fontSize: 20 }}
              value={joinCode}
              onChange={e => setJoinCode(e.target.value.toUpperCase())}
              placeholder="XXXXXX"
              maxLength={6}
            />
          </div>
        )}

        {error && <div style={styles.error}>{error}</div>}

        <button
          style={loading ? styles.btnDisabled : styles.btnPrimary}
          onClick={tab === "create" ? handleCreate : handleJoin}
          disabled={loading}
        >
          {loading ? "..." : tab === "create" ? "Créer la partie" : "Rejoindre"}
        </button>

        <button style={styles.btnSecondary} onClick={onBack}>Retour</button>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)",
    display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
  },
  card: {
    background: "#1a1a2e", border: "1px solid #333", borderRadius: 12,
    padding: "36px 40px", width: 420, display: "flex", flexDirection: "column", gap: 16,
  },
  title: { color: "#e0e0e0", fontSize: 22, fontWeight: 700, margin: 0, textAlign: "center" },
  sub: { color: "#aaa", textAlign: "center", margin: 0 },
  hint: { color: "#888", textAlign: "center", fontSize: 13, margin: 0 },
  codeBox: {
    background: "#0d0d1a", border: "2px solid #4a90d9", borderRadius: 8,
    padding: "14px 0", textAlign: "center", fontSize: 32, fontWeight: 800,
    color: "#4a90d9", letterSpacing: 8, fontFamily: "monospace",
  },
  tabs: { display: "flex", gap: 8 },
  tab: {
    flex: 1, padding: "8px 0", background: "#0d0d1a", border: "1px solid #333",
    borderRadius: 6, color: "#888", cursor: "pointer", fontSize: 14,
  },
  tabActive: {
    flex: 1, padding: "8px 0", background: "#1e3a5f", border: "1px solid #4a90d9",
    borderRadius: 6, color: "#4a90d9", cursor: "pointer", fontSize: 14, fontWeight: 700,
  },
  field: { display: "flex", flexDirection: "column", gap: 6 },
  label: { color: "#aaa", fontSize: 13 },
  input: {
    background: "#0d0d1a", border: "1px solid #444", borderRadius: 6,
    color: "#e0e0e0", padding: "10px 12px", fontSize: 15, outline: "none",
  },
  error: {
    background: "rgba(220,50,50,0.15)", border: "1px solid #c0392b",
    borderRadius: 6, padding: "8px 12px", color: "#e74c3c", fontSize: 13,
  },
  btnPrimary: {
    background: "#2563eb", border: "none", borderRadius: 8, color: "#fff",
    padding: "12px 0", fontSize: 15, fontWeight: 700, cursor: "pointer",
  },
  btnDisabled: {
    background: "#444", border: "none", borderRadius: 8, color: "#888",
    padding: "12px 0", fontSize: 15, fontWeight: 700, cursor: "not-allowed",
  },
  btnSecondary: {
    background: "transparent", border: "1px solid #444", borderRadius: 8,
    color: "#888", padding: "10px 0", fontSize: 14, cursor: "pointer",
  },
};

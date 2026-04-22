import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import axios from "axios";
import { API, API_CLIENT, useSession } from "../shared";
import TeamLogo from "./TeamLogo";
import LeaguePicker, { LEAGUE_META } from "./LeaguePicker";

const LEAGUES = ["LEC", "LCS", "LCK", "LPL", "CBLOL"];

function MultiplayerSlots({ onEnterSession }) {
  const { sid: savedSid, code: savedCode, username: savedUsername, setSession, clearSession } = useSession();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState(null); // null | "create" | "join"
  const [username, setUsername] = useState("");
  const [league, setLeague] = useState("LEC");
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Listing is public — do it without session_id so the API_CLIENT doesn't
    // short-circuit with a stale session.
    axios.get(API + "/mp2/sessions")
      .then(r => setSessions((r.data || []).filter(s => s.phase !== "finished")))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleCreate = async () => {
    if (!username.trim()) { setError("Entrez votre pseudo"); return; }
    setBusy(true); setError(null);
    try {
      const res = await API_CLIENT.post("/mp2/create", { league, username: username.trim() });
      const { sid, code, token } = res.data;
      setSession({ sid, code, token });
      onEnterSession?.();
    } catch (e) { setError(e?.response?.data?.detail || "Erreur"); }
    finally { setBusy(false); }
  };

  const handleJoin = async (code) => {
    const finalCode = (code || joinCode).trim().toUpperCase();
    if (!username.trim()) { setError("Entrez votre pseudo"); return; }
    if (!finalCode) { setError("Entrez le code"); return; }
    setBusy(true); setError(null);
    try {
      const res = await API_CLIENT.post("/mp2/join", { code: finalCode, username: username.trim() });
      const { sid, code: respCode, token } = res.data;
      setSession({ sid, code: respCode, token });
      onEnterSession?.();
    } catch (e) { setError(e?.response?.data?.detail || "Code invalide"); }
    finally { setBusy(false); }
  };

  const phaseLabel = (p) => ({ waiting: "Attente", team_pick: "Sélection", regular: "Saison", playoffs: "Playoffs" }[p] || p);

  return (
    <div style={{ marginTop: 40, width: "100%", maxWidth: 900, margin: "40px auto 0" }}>
      <div style={{ color: "var(--text-2)", fontSize: 12, textTransform: "uppercase", letterSpacing: 2, marginBottom: 16, textAlign: "center" }}>
        Multijoueur
      </div>
      <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>

        {/* Session en cours (restaurée via SessionProvider) */}
        {savedSid && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            style={cardStyle("#1e3a5f", "#2563eb44")}
          >
            <div style={{ color: "#4a90d9", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Session en cours</div>
            <div style={{ color: "#e0e0e0", fontWeight: 700, fontSize: 15, marginBottom: 4 }}>
              {savedCode || "Code sauvegardé"}
            </div>
            <div style={{ color: "#888", fontSize: 12, marginBottom: 16 }}>
              {savedSid.slice(0, 8)}…
            </div>
            <button className="btn-primary" onClick={() => onEnterSession?.()}
              style={{ padding: "10px 0", width: "100%", marginBottom: 8 }}>
              Entrer dans la session
            </button>
            <button onClick={clearSession}
              style={{ background: "none", border: "1px solid var(--danger)", color: "var(--danger)", borderRadius: 4, padding: "6px 0", fontSize: 12, cursor: "pointer", width: "100%" }}>
              Quitter la session
            </button>
          </motion.div>
        )}

        {/* Sessions actives sur le serveur */}
        {!loading && sessions.map((s, i) => (
          <motion.div key={s.sid} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
            style={cardStyle()}
          >
            <div style={{ color: "var(--text-2)", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
              {s.league} · {phaseLabel(s.phase)}
            </div>
            <div style={{ color: "#4a90d9", fontWeight: 800, fontSize: 22, letterSpacing: 4, fontFamily: "monospace", marginBottom: 8 }}>
              {s.code}
            </div>
            <div style={{ color: "var(--text-2)", fontSize: 12, marginBottom: 4 }}>
              Semaine {s.current_week} · {s.players?.length || 0} joueur(s)
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 12 }}>
              {(s.players || []).map((p, j) => (
                <span key={j} style={{ background: "#1a1a2e", border: "1px solid #333", borderRadius: 4, padding: "2px 8px", fontSize: 11, color: "#aaa" }}>
                  {p}
                </span>
              ))}
            </div>
            {/* Si déjà connecté à cette session, bouton "Entrer" */}
            {savedSid === s.sid ? (
              <button className="btn-primary" style={{ padding: "8px 0", width: "100%" }}
                onClick={() => onEnterSession?.()}>
                Entrer
              </button>
            ) : mode === `join-${s.sid}` ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <input style={inputStyle} value={username} onChange={e => setUsername(e.target.value)}
                  placeholder="Votre pseudo" maxLength={20} />
                {error && <div style={{ color: "#ef4444", fontSize: 12 }}>{error}</div>}
                <button className="btn-primary" style={{ padding: "8px 0" }}
                  onClick={() => handleJoin(s.code)} disabled={busy}>
                  Rejoindre
                </button>
                <button style={cancelBtnStyle} onClick={() => setMode(null)}>Annuler</button>
              </div>
            ) : (
              <button className="btn-primary" style={{ padding: "8px 0", width: "100%" }}
                onClick={() => { setMode(`join-${s.sid}`); setError(null); }}>
                Rejoindre
              </button>
            )}
          </motion.div>
        ))}

        {/* Créer une nouvelle partie */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          style={cardStyle()}>
          <div style={{ color: "var(--text-2)", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
            Nouvelle partie
          </div>
          {mode === "create" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input style={inputStyle} value={username} onChange={e => setUsername(e.target.value)}
                placeholder="Votre pseudo" maxLength={20} />
              <select style={inputStyle} value={league} onChange={e => setLeague(e.target.value)}>
                {LEAGUES.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
              {error && <div style={{ color: "#ef4444", fontSize: 12 }}>{error}</div>}
              <button className="btn-primary" style={{ padding: "10px 0" }} onClick={handleCreate} disabled={busy}>
                {busy ? "…" : "Créer"}
              </button>
              <button style={cancelBtnStyle} onClick={() => { setMode(null); setError(null); }}>Annuler</button>
            </div>
          ) : mode === "join" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input style={inputStyle} value={username} onChange={e => setUsername(e.target.value)}
                placeholder="Votre pseudo" maxLength={20} />
              <input style={{ ...inputStyle, textTransform: "uppercase", letterSpacing: 4, fontSize: 18 }}
                value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase())}
                placeholder="CODE" maxLength={6} />
              {error && <div style={{ color: "#ef4444", fontSize: 12 }}>{error}</div>}
              <button className="btn-primary" style={{ padding: "10px 0" }} onClick={handleJoin} disabled={busy}>
                {busy ? "…" : "Rejoindre"}
              </button>
              <button style={cancelBtnStyle} onClick={() => { setMode(null); setError(null); }}>Annuler</button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button className="btn-primary" style={{ padding: "10px 0" }} onClick={() => { setMode("create"); setError(null); }}>
                Créer une partie
              </button>
              <button className="btn-secondary" style={{ padding: "9px 0" }} onClick={() => { setMode("join"); setError(null); }}>
                Rejoindre par code
              </button>
            </div>
          )}
        </motion.div>

      </div>
    </div>
  );
}

const cardStyle = (bg = "var(--bg-card)", border = "1px solid var(--border)") => ({
  background: bg, border, borderRadius: 8, padding: 24, width: 220,
  minHeight: 180, display: "flex", flexDirection: "column", justifyContent: "space-between",
});
const inputStyle = {
  background: "#0d0d1a", border: "1px solid #333", borderRadius: 6,
  color: "#e0e0e0", padding: "8px 10px", fontSize: 14, outline: "none", width: "100%", boxSizing: "border-box",
};
const cancelBtnStyle = {
  background: "transparent", border: "1px solid #333", borderRadius: 6,
  color: "#666", padding: "7px 0", fontSize: 13, cursor: "pointer",
};

const SaveSelectionPage = ({ onLoad, onNew, onEnterSession }) => {
  const [saves, setSaves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pendingSlot, setPendingSlot] = useState(null); // slot awaiting league selection

  useEffect(() => {
    axios.get(API + "/saves").then(r => { setSaves(r.data); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const handleLoad = async (slot) => {
    setBusy(true);
    try { await onLoad(slot); } finally { setBusy(false); }
  };
  const handleNew = (slot) => {
    setPendingSlot(slot);  // open league picker
  };
  const handleLeagueConfirm = async (league) => {
    const slot = pendingSlot;
    setBusy(true);
    setPendingSlot(null);
    try { await onNew(slot, league); } finally { setBusy(false); }
  };
  const handleDelete = async (slot) => {
    await axios.delete(API + `/saves/${slot}`);
    setSaves(prev => prev.map(s => s.slot === slot ? { slot, exists: false } : s));
  };

  const phaseLabel = (p) => p === "playoffs" ? "Playoffs" : p === "offseason" ? "Hors-saison" : "Saison régulière";

  return (
    <div className="team-picker hex-bg">
      {pendingSlot !== null && (
        <LeaguePicker
          onSelect={handleLeagueConfirm}
          onCancel={() => setPendingSlot(null)}
        />
      )}
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="text-center">
        <h1 className="font-heading">League <span>Manager</span> 2026</h1>
        <p className="subtitle">Choisissez une sauvegarde</p>
      </motion.div>

      {loading ? (
        <div style={{ textAlign: "center", color: "var(--text-2)", marginTop: 40 }}>Chargement...</div>
      ) : (
        <div style={{ display: "flex", gap: 24, justifyContent: "center", flexWrap: "wrap", marginTop: 32 }}>
          {saves.map((s, idx) => (
            <motion.div
              key={s.slot}
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.08 }}
              style={{
                background: "var(--bg-card)", border: "1px solid var(--border)",
                borderRadius: 8, padding: 28, width: 260, minHeight: 200,
                display: "flex", flexDirection: "column", justifyContent: "space-between"
              }}
            >
              <div>
                <div style={{ color: "var(--text-2)", fontSize: 12, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
                  Slot {s.slot}
                </div>
                {s.exists ? (
                  <>
                    <div style={{ marginBottom: 8 }}>
                      <TeamLogo teamId={s.user_team} abbr={s.team_abbr} size={56} />
                    </div>
                    <div style={{ color: "var(--text-1)", fontWeight: 600, marginBottom: 4 }}>{s.team_name}</div>
                    <div style={{ color: "var(--text-2)", fontSize: 13 }}>
                      Semaine {s.week} · {phaseLabel(s.phase)}
                    </div>
                    <div style={{ color: "var(--amber)", fontSize: 13, marginTop: 4 }}>
                      {s.wins}V – {s.losses}D
                    </div>
                    {s.league && (
                      <div style={{
                        display: "inline-block", marginTop: 8, padding: "2px 8px",
                        borderRadius: 4, fontSize: 11, fontWeight: 700, letterSpacing: 1,
                        background: (LEAGUE_META[s.league]?.color || "#888") + "22",
                        color: LEAGUE_META[s.league]?.color || "#888",
                        border: `1px solid ${LEAGUE_META[s.league]?.color || "#888"}44`
                      }}>
                        {LEAGUE_META[s.league]?.flag || ""} {s.league}
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ color: "var(--text-2)", fontSize: 15, marginTop: 16 }}>Emplacement vide</div>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 20 }}>
                {s.exists ? (
                  <>
                    <button className="btn-primary" onClick={() => handleLoad(s.slot)} disabled={busy} style={{ padding: "10px 0" }}>
                      Charger
                    </button>
                    <button className="btn-secondary" onClick={() => handleNew(s.slot)} disabled={busy} style={{ padding: "8px 0", fontSize: 13 }}>
                      Nouvelle partie
                    </button>
                    <button
                      onClick={() => handleDelete(s.slot)} disabled={busy}
                      style={{ background: "none", border: "1px solid var(--danger)", color: "var(--danger)", borderRadius: 4, padding: "6px 0", fontSize: 12, cursor: "pointer" }}
                    >
                      Supprimer
                    </button>
                  </>
                ) : (
                  <button className="btn-primary" onClick={() => handleNew(s.slot)} disabled={busy} style={{ padding: "10px 0" }}>
                    Nouvelle partie
                  </button>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* ── Multijoueur ── */}
      <MultiplayerSlots onEnterSession={onEnterSession} />
    </div>
  );
};

export default SaveSelectionPage;

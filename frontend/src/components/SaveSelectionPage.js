import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import axios from "axios";
import { API } from "../shared";
import TeamLogo from "./TeamLogo";
import LeaguePicker, { LEAGUE_META } from "./LeaguePicker";

const SaveSelectionPage = ({ onLoad, onNew }) => {
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
    </div>
  );
};

export default SaveSelectionPage;

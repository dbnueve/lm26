import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import axios from "axios";
import { API } from "../shared";

// League flag / color mapping
export const LEAGUE_META = {
  LEC:   { color: "#00C8FF", region: "Europe",        flag: "🇪🇺" },
  LCK:   { color: "#C0392B", region: "Korea",         flag: "🇰🇷" },
  LPL:   { color: "#E74C3C", region: "Chine",         flag: "🇨🇳" },
  LCS:   { color: "#3498DB", region: "Amérique du Nord", flag: "🇺🇸" },
  CBLOL: { color: "#27AE60", region: "Brésil",        flag: "🇧🇷" },
};

const LeaguePicker = ({ onSelect, onCancel }) => {
  const [leagues, setLeagues] = useState([]);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    axios.get(API + "/leagues").then(r => setLeagues(r.data)).catch(() => {});
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: 40, width: 560, maxWidth: "95vw" }}
      >
        <h2 style={{ margin: "0 0 8px", color: "var(--text-1)" }}>Choisissez une ligue</h2>
        <p style={{ color: "var(--text-2)", margin: "0 0 28px", fontSize: 14 }}>Sélectionnez la ligue que vous souhaitez manager.</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 28 }}>
          {leagues.map(lg => {
            const meta = LEAGUE_META[lg.id] || { color: "var(--amber)", region: lg.region, flag: "🌐" };
            const isSelected = selected === lg.id;
            return (
              <motion.div
                key={lg.id}
                whileHover={{ scale: 1.03 }}
                onClick={() => setSelected(lg.id)}
                style={{
                  border: `2px solid ${isSelected ? meta.color : "var(--border)"}`,
                  borderRadius: 8, padding: "16px 20px", cursor: "pointer",
                  background: isSelected ? `${meta.color}15` : "var(--bg-secondary)",
                  transition: "border-color 0.15s, background 0.15s"
                }}
              >
                <div style={{ fontSize: 28, marginBottom: 6 }}>{meta.flag}</div>
                <div style={{ fontWeight: 700, color: meta.color, fontSize: 18 }}>{lg.id}</div>
                <div style={{ color: "var(--text-1)", fontSize: 13, fontWeight: 500 }}>{lg.full_name}</div>
                <div style={{ color: "var(--text-2)", fontSize: 12, marginTop: 4 }}>{meta.region} · {lg.team_count} équipes</div>
              </motion.div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{ background: "none", border: "1px solid var(--border)", color: "var(--text-2)", borderRadius: 6, padding: "10px 20px", cursor: "pointer" }}>
            Annuler
          </button>
          <button
            onClick={() => selected && onSelect(selected)}
            disabled={!selected}
            className="btn-primary"
            style={{ padding: "10px 28px", opacity: selected ? 1 : 0.5, cursor: selected ? "pointer" : "default" }}
          >
            Confirmer
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default LeaguePicker;

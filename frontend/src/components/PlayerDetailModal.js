import React from "react";
import { motion } from "framer-motion";
import { X, Star } from "@phosphor-icons/react";
import { PlayerImagesContext, toFlag } from "../shared";
import { _ddVersion, toDDragonKey } from "./ddHelpers";

// ─── Shared PlayerDetailModal ────────────────────────────────────────────────
// Used in Scouting, Roster, Negotiations and Dashboard.
// Pass `actions` prop to render buttons below the stats (sign, offer, swap…).
const PlayerDetailModal = ({ player, onClose, actions = null }) => {
  const playerImages = React.useContext(PlayerImagesContext);
  if (!player) return null;
  const imgUrl = playerImages[player.name.toLowerCase()];
  const getPotentialColor = (v) => v >= 90 ? "var(--success)" : v >= 80 ? "var(--secondary)" : "var(--text-secondary)";
  const attrs = [
    { label: "Mécanique",  key: "mechanics",   color: "var(--primary)" },
    { label: "Game Sense", key: "game_sense",   color: "#a78bfa" },
    { label: "Teamwork",   key: "teamwork",     color: "var(--secondary)" },
    { label: "Clutch",     key: "clutch",       color: "#f59e0b" },
    { label: "Consist.",   key: "consistency",  color: "#34d399" },
    { label: "Performances",      key: "avg_perf",        color: "#60a5fa" },
  ];
  const teamLabel = player.current_team || player.team_abbr || "";
  const leagueLabel = player.league || "";

  return (
    <motion.div
      className="modal-overlay"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.92, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.92, opacity: 0, y: 20 }}
        onClick={e => e.stopPropagation()}
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-subtle)", borderRadius: 4, width: 560, maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.6)" }}
      >
        {/* Hero banner */}
        <div style={{ background: "linear-gradient(135deg, var(--surface) 0%, #1a1a2e 100%)", padding: "24px 24px 20px", borderBottom: "1px solid var(--border-subtle)", position: "relative" }}>
          <button onClick={onClose} style={{ position: "absolute", top: 16, right: 16, background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", padding: 4 }}>
            <X size={20} />
          </button>
          <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
            <div style={{ width: 72, height: 72, borderRadius: "50%", overflow: "hidden", flexShrink: 0, background: "var(--surface)", border: "2px solid var(--border-subtle)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 700, color: "var(--primary)" }}>
              {imgUrl
                ? <img loading="lazy" src={imgUrl} alt={player.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={e => { e.currentTarget.style.display = "none"; }} />
                : player.name.substring(0, 2).toUpperCase()
              }
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
                <span className="font-heading" style={{ fontSize: 22, fontWeight: 700 }}>{player.name}</span>
                <span style={{ fontSize: 18 }}>{toFlag(player.nationality)}</span>
                <span className={"pos-badge pos-" + player.position} style={{ fontSize: 11 }}>{player.position}</span>
              </div>
              <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 10 }}>
                {teamLabel}{leagueLabel ? ` · ${leagueLabel}` : ""} · {player.age} ans
              </div>
              <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
                {[
                  { label: "Rating",    value: player.rating,               color: "var(--primary)" },
                  { label: "Potentiel", value: player.potential,            color: getPotentialColor(player.potential), star: player.potential >= 90 },
                  { label: "KDA",       value: player.kda?.toFixed(2) ?? "—", color: "var(--secondary)" },
                  { label: "CS/min",    value: player.cs_min?.toFixed(1) ?? "—", color: "#60a5fa" },
                ].map(({ label, value, color, star }) => (
                  <div key={label}>
                    <div style={{ fontSize: 11, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 1 }}>{label}</div>
                    <div className="font-stats" style={{ fontSize: 30, fontWeight: 700, color, lineHeight: 1, display: "flex", alignItems: "center", gap: 4 }}>
                      {value}{star && <Star size={14} weight="fill" />}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Attribute bars */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "var(--text-secondary)", marginBottom: 12 }}>Attributs</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 24px" }}>
              {attrs.map(({ label, key, color }) => {
                const val = player[key] ?? 0;
                const pct = key === "avg_perf" 
        ? Math.min(100, Math.max(0, val * 10))
        : Math.min(100, Math.max(0, ((val - 50) / 50) * 100));
                return (
                  <div key={key}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{label}</span>
                      <span className="font-stats" style={{ fontSize: 12, fontWeight: 700, color }}>{val}</span>
                    </div>
                    <div style={{ height: 4, background: "var(--border-subtle)", borderRadius: 2 }}>
                      <motion.div initial={{ width: 0 }} animate={{ width: pct + "%" }} transition={{ duration: 0.5, ease: "easeOut" }}
                        style={{ height: "100%", borderRadius: 2, background: color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Performance tiles */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
            {[
              { label: "Kill Part.", value: player.kp != null ? player.kp + "%" : "—" },
              { label: "Moral",      value: player.moral ?? "—" },
              { label: "Fatigue",    value: player.fatigue != null ? player.fatigue + "%" : "—" },
            ].map(({ label, value }) => (
              <div key={label} style={{ background: "var(--surface)", borderRadius: 2, padding: "10px 12px", textAlign: "center" }}>
                <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4 }}>{label}</div>
                <div className="font-stats" style={{ fontWeight: 700, fontSize: 16 }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Champion pool */}
          {player.champion_pool?.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "var(--text-secondary)", marginBottom: 10 }}>Pool de champions</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {player.champion_pool.map((champ, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--surface)", border: "1px solid var(--border-subtle)", borderRadius: 20, padding: "4px 10px 4px 6px" }}>
                    <img loading="lazy" src={`https://ddragon.leagueoflegends.com/cdn/${_ddVersion}/img/champion/${toDDragonKey(champ)}.png`}
                      alt={champ} style={{ width: 22, height: 22, borderRadius: "50%", objectFit: "cover" }}
                      onError={e => { e.currentTarget.style.display = "none"; }} />
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{champ}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Salary + transfer value */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div style={{ background: "var(--surface)", borderRadius: 2, padding: "10px 14px" }}>
              <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4 }}>Salaire</div>
              <div className="font-stats" style={{ fontWeight: 700, color: "var(--secondary)" }}>
                {Math.round((player.salary ?? 40000) / 1000)}K EUR/an
              </div>
            </div>
            <div style={{ background: "var(--surface)", borderRadius: 2, padding: "10px 14px" }}>
              <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4 }}>Valeur de transfert</div>
              <div className="font-stats" style={{ fontWeight: 700, color: "var(--text-primary)" }}>
                {(( player.transfer_value ?? 0) / 1000).toFixed(0)}K EUR
              </div>
            </div>
          </div>

          {/* Caller-supplied action buttons */}
          {actions}
        </div>
      </motion.div>
    </motion.div>
  );
};

export default PlayerDetailModal;

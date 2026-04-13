import React, { useState } from "react";
import { motion } from "framer-motion";
import { X, Star } from "@phosphor-icons/react";
import { PlayerImagesContext, toFlag } from "../shared";
import { _ddVersion, toDDragonKey } from "./ddHelpers";

// ─── Shared PlayerDetailModal ────────────────────────────────────────────────
// Used in Scouting, Roster, Negotiations and Dashboard.
// Pass `actions` prop to render buttons below the stats (sign, offer, swap…).
const PlayerDetailModal = ({ player, onClose, actions = null }) => {
  const playerImages = React.useContext(PlayerImagesContext);
  const [tab, setTab] = useState("overview");
  if (!player) return null;

  const imgUrl = playerImages[player.name.toLowerCase()];
  const getPotentialColor = (v) => v >= 90 ? "var(--success)" : v >= 80 ? "var(--secondary)" : "var(--text-secondary)";
  const teamLabel = player.current_team || player.team_abbr || "";
  const leagueLabel = player.league || "";

  const attrs = [
    { label: "Mécanique",   key: "mechanics",  color: "var(--primary)" },
    { label: "Game Sense",  key: "game_sense", color: "#a78bfa" },
    { label: "Teamwork",    key: "teamwork",   color: "var(--secondary)" },
    { label: "Clutch",      key: "clutch",     color: "#f59e0b" },
    { label: "Consistance", key: "consistency",color: "#34d399" },
    { label: "Perf moy.",   key: "avg_perf",   color: "#60a5fa" },
  ];

  const tabs = [
    { id: "overview",  label: "Aperçu" },
    { id: "stats",     label: "Stats" },
    { id: "champions", label: "Champions" },
  ];

  const sigChamp = player.champion_pool?.[0];
  const sigSplashKey = sigChamp ? toDDragonKey(sigChamp) : null;
  const splashUrl = sigSplashKey
    ? `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${sigSplashKey}_0.jpg`
    : null;

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
        {/* Hero banner with optional splash background */}
        <div style={{ position: "relative", background: "linear-gradient(135deg, var(--surface) 0%, #1a1a2e 100%)", padding: "24px 24px 0", borderBottom: "1px solid var(--border-subtle)", overflow: "hidden" }}>
          
          <div style={{ position: "relative", zIndex: 1 }}>
            <button onClick={onClose} style={{ position: "absolute", top: 0, right: 0, background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", padding: 4 }}>
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
                    { label: "Rating",    value: player.rating,                   color: "var(--primary)" },
                    { label: "Potentiel", value: player.potential,                color: getPotentialColor(player.potential), star: player.potential >= 90 },
                    { label: "KDA",       value: player.kda?.toFixed(2) ?? "—",   color: "var(--secondary)" },
                    { label: "CS/min",    value: player.cs_min?.toFixed(1) ?? "—",color: "#60a5fa" },
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

            {/* Tab bar */}
            <div style={{ display: "flex", gap: 0, marginTop: 20 }}>
              {tabs.map(t => (
                <button key={t.id} onClick={() => setTab(t.id)} style={{
                  padding: "8px 18px", fontSize: 13, fontWeight: 600,
                  background: "transparent", border: "none", cursor: "pointer",
                  color: tab === t.id ? "var(--primary)" : "var(--text-secondary)",
                  borderBottom: tab === t.id ? "2px solid var(--primary)" : "2px solid transparent",
                  transition: "all 0.15s",
                }}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 18 }}>

          {/* ── OVERVIEW TAB ─────────────────────────────────────────────────── */}
          {tab === "overview" && (
            <>
              {/* Morale + Fatigue */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {[
                  { label: "Moral",   value: player.moral ?? 0,    color: (player.moral ?? 0) > 70 ? "var(--success)" : (player.moral ?? 0) > 40 ? "var(--secondary)" : "var(--danger)" },
                  { label: "Fatigue", value: player.fatigue ?? 0,  color: (player.fatigue ?? 0) > 70 ? "var(--danger)" : (player.fatigue ?? 0) > 40 ? "var(--secondary)" : "var(--success)" },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ background: "var(--surface)", borderRadius: 6, padding: "12px 14px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 8 }}>
                      <span style={{ color: "var(--text-secondary)" }}>{label}</span>
                      <span className="font-stats" style={{ fontWeight: 700, color }}>{value}%</span>
                    </div>
                    <div style={{ height: 6, background: "var(--border-subtle)", borderRadius: 3 }}>
                      <motion.div initial={{ width: 0 }} animate={{ width: value + "%" }} transition={{ duration: 0.5, ease: "easeOut" }}
                        style={{ height: "100%", borderRadius: 3, background: color }} />
                    </div>
                  </div>
                ))}
              </div>

              {/* Performance tiles */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                {[
                  { label: "Kill Part.", value: player.kp != null ? player.kp + "%" : "—" },
                  { label: "Salaire",    value: Math.round((player.salary ?? 40000) / 1000) + "K/an" },
                  { label: "Transfert",  value: ((player.transfer_value ?? 0) / 1000).toFixed(0) + "K" },
                ].map(({ label, value }) => (
                  <div key={label} style={{ background: "var(--surface)", borderRadius: 4, padding: "10px 12px", textAlign: "center" }}>
                    <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4 }}>{label}</div>
                    <div className="font-stats" style={{ fontWeight: 700, fontSize: 15 }}>{value}</div>
                  </div>
                ))}
              </div>

              {/* Signature champion highlight */}
              {sigChamp && (
                <div style={{ display: "flex", alignItems: "center", gap: 14, background: "var(--surface)", borderRadius: 6, padding: "12px 16px", border: "1px solid var(--border-subtle)" }}>
                  <img loading="lazy"
                    src={`https://ddragon.leagueoflegends.com/cdn/${_ddVersion}/img/champion/${sigSplashKey}.png`}
                    alt={sigChamp}
                    style={{ width: 44, height: 44, borderRadius: 6, objectFit: "cover", border: "1px solid var(--border-subtle)" }}
                    onError={e => { e.currentTarget.style.display = "none"; }}
                  />
                  <div>
                    <div style={{ fontSize: 11, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 1 }}>Champion signature</div>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{sigChamp}</div>
                  </div>
                </div>
              )}

              {actions}
            </>
          )}

          {/* ── STATS TAB ────────────────────────────────────────────────────── */}
          {tab === "stats" && (
            <>
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

              {/* Perf history */}
              {player.perf_history?.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "var(--text-secondary)", marginBottom: 10 }}>Historique performances</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {player.perf_history.map((score, i) => (
                      <div key={i} style={{
                        padding: "4px 10px", borderRadius: 4, fontSize: 13, fontWeight: 700,
                        background: "var(--surface)", border: "1px solid var(--border-subtle)",
                        color: score >= 8 ? "var(--secondary)" : score >= 6 ? "var(--success)" : score >= 4 ? "var(--text-primary)" : "var(--danger)",
                      }}>
                        {score.toFixed(1)}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {actions}
            </>
          )}

          {/* ── CHAMPIONS TAB ────────────────────────────────────────────────── */}
          {tab === "champions" && (
            <>
              {player.champion_pool?.length > 0 ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                  {player.champion_pool.map((champ, i) => {
                    const key = toDDragonKey(champ);
                    const playRate = i === 0 ? "Signature" : i === 1 ? "Fréquent" : i === 2 ? "Régulier" : "Occasionnel";
                    const rateColor = i === 0 ? "var(--secondary)" : i === 1 ? "var(--primary)" : "var(--text-secondary)";
                    return (
                      <div key={i} style={{ background: "var(--surface)", borderRadius: 6, overflow: "hidden", border: "1px solid var(--border-subtle)" }}>
                        <div style={{ position: "relative", height: 90, overflow: "hidden" }}>
                          <img loading="lazy"
                            src={`https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${key}_0.jpg`}
                            alt={champ}
                            style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top" }}
                            onError={e => { e.currentTarget.style.display = "none"; }}
                          />
                          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 60%)" }} />
                          <img loading="lazy"
                            src={`https://ddragon.leagueoflegends.com/cdn/${_ddVersion}/img/champion/${key}.png`}
                            alt=""
                            style={{ position: "absolute", bottom: 6, left: 6, width: 24, height: 24, borderRadius: 4, border: "1px solid var(--border-subtle)" }}
                            onError={e => { e.currentTarget.style.display = "none"; }}
                          />
                        </div>
                        <div style={{ padding: "8px 10px" }}>
                          <div style={{ fontWeight: 700, fontSize: 13 }}>{champ}</div>
                          <div style={{ fontSize: 11, color: rateColor, marginTop: 2 }}>{playRate}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-secondary)" }}>
                  Aucun champion enregistré
                </div>
              )}

              {actions}
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};

export default PlayerDetailModal;

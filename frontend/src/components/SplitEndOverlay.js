import React, { useState, useContext } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { TeamLogosContext, formatMoney } from "../shared";

// ── helpers ──────────────────────────────────────────────────────────────────

const LEAGUE_META = {
  LEC:   { label: "LEC",   full: "LoL EMEA Championship",          flag: "🇪🇺", color: "#0a84ff" },
  LCK:   { label: "LCK",   full: "LoL Champions Korea",            flag: "🇰🇷", color: "#d4af37" },
  LPL:   { label: "LPL",   full: "LoL Pro League",                 flag: "🇨🇳", color: "#e63946" },
  LCS:   { label: "LCS",   full: "LoL Championship Series",        flag: "🇺🇸", color: "#7b2d8b" },
  CBLOL: { label: "CBLOL", full: "Campeonato Brasileiro de LoL",   flag: "🇧🇷", color: "#00b37e" },
};

const posColors = {
  TOP: "var(--secondary)", JUNGLE: "var(--success)",
  MID: "var(--primary)", ADC: "var(--danger)", SUPPORT: "#7B5CF5",
};

// ── sub-components ────────────────────────────────────────────────────────────

function RegionCard({ league, data, isHighlighted }) {
  const logos = useContext(TeamLogosContext);
  const meta = LEAGUE_META[league] || { label: league, full: league, flag: "🌐", color: "#888" };
  const champ = data?.champion;
  const logoUrl = champ ? logos[champ.id] : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 }}
      style={{
        background: isHighlighted
          ? `linear-gradient(135deg, rgba(255,184,0,.12) 0%, rgba(255,184,0,.04) 100%)`
          : "var(--surface)",
        border: `1px solid ${isHighlighted ? "rgba(255,184,0,.45)" : "rgba(255,255,255,.08)"}`,
        borderRadius: 6,
        padding: "14px 12px",
        textAlign: "center",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* region accent bar */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 2,
        background: meta.color,
        opacity: isHighlighted ? 1 : 0.5,
      }} />

      {/* league flag + name */}
      <div style={{ fontSize: 18, marginBottom: 2 }}>{meta.flag}</div>
      <div style={{
        fontFamily: "'Barlow Condensed', sans-serif",
        fontSize: 11, fontWeight: 800, letterSpacing: 2,
        color: isHighlighted ? "var(--secondary)" : "var(--text-secondary)",
        textTransform: "uppercase", marginBottom: 10,
      }}>{meta.label}</div>

      {/* champion logo or placeholder */}
      {logoUrl ? (
        <img
          src={logoUrl}
          alt={champ?.abbr}
          loading="lazy"
          style={{ width: 44, height: 44, objectFit: "contain", marginBottom: 6,display: "block",    // Indispensable pour que le margin auto fonctionne
      margin: "0 auto 6px"  }}
        />
      ) : (
        <div style={{
          width: 44, height: 44, borderRadius: "50%",
          background: `${meta.color}33`,
          display: "flex", alignItems: "center", justifyContent: "center",
          margin: "0 auto 6px",
          fontFamily: "'Barlow Condensed', sans-serif",
          fontSize: 14, fontWeight: 800, color: meta.color,
        }}>
          {champ?.abbr || "?"}
        </div>
      )}

      {/* champion name */}
      <div style={{
        fontFamily: "'Barlow Condensed', sans-serif",
        fontSize: 13, fontWeight: 700,
        color: isHighlighted ? "var(--secondary)" : "var(--text-primary)",
        lineHeight: 1.2,
      }}>
        {champ?.name || "—"}
      </div>
      {isHighlighted && (
        <div style={{
          marginTop: 4, fontSize: 9, letterSpacing: 1.5,
          color: "rgba(255,184,0,.7)", textTransform: "uppercase",
        }}>Champion</div>
      )}
    </motion.div>
  );
}

function InternationalBanner({ result }) {
  const logos = useContext(TeamLogosContext);
  if (!result?.winner) return null;
  const logoUrl = logos[result.winner.id];
  const isWorlds = result.type === "worlds";

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: 0.15 }}
      style={{
        background: isWorlds
          ? "linear-gradient(135deg, rgba(255,184,0,.15) 0%, rgba(255,100,0,.08) 100%)"
          : "linear-gradient(135deg, rgba(10,132,255,.15) 0%, rgba(0,180,120,.08) 100%)",
        border: `1px solid ${isWorlds ? "rgba(255,184,0,.4)" : "rgba(10,132,255,.35)"}`,
        borderRadius: 6,
        padding: "16px 20px",
        display: "flex",
        alignItems: "center",
        gap: 16,
        marginBottom: 16,
      }}
    >
      <div style={{ fontSize: 28 }}>{isWorlds ? "🌍" : "🏅"}</div>
      <div style={{ flex: 1 }}>
        <div style={{
          fontFamily: "'Barlow Condensed', sans-serif",
          fontSize: 10, fontWeight: 800, letterSpacing: 2,
          color: isWorlds ? "rgba(255,184,0,.8)" : "rgba(10,132,255,.9)",
          textTransform: "uppercase", marginBottom: 3,
        }}>
          {result.name} — Vainqueur
        </div>
        <div style={{
          fontFamily: "'Barlow Condensed', sans-serif",
          fontSize: 20, fontWeight: 900,
          color: isWorlds ? "var(--secondary)" : "var(--primary)",
        }}>
          {result.winner.name}
        </div>
      </div>
      {logoUrl && (
        <img
          src={logoUrl}
          alt={result.winner.abbr}
          loading="lazy"
          style={{ width: 48, height: 48, objectFit: "contain" }}
        />
      )}
    </motion.div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

const SplitEndOverlay = ({ splitStatus, userTeam, onNextSplit, onChangeTeam }) => {
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("recap"); // "recap" | "history"

  const {
    current_split, next_split, champion, history,
    roster_changes_preview, other_regions, international_result,
  } = splitStatus;

  const lastEntry = history && history.length > 0 ? history[history.length - 1] : null;

  // Detect user's league from other_regions (most reliable) or fall back to label parsing
  const userLeague = Object.keys(other_regions || {}).find(lg => other_regions[lg]?.is_user_league)
    || splitStatus.current_split?.label?.match(/\b(LEC|LCK|LPL|LCS|CBLOL)\b/)?.[0]
    || userTeam?.league || "LEC";

  // Replace "LEC" in backend labels with the real league name
  const fixLabel = (label) => label ? label.replace(/\bLEC\b/g, userLeague) : label;
  const currentLabel = fixLabel(current_split?.label);
  const nextLabel    = fixLabel(next_split?.label);

  const handleNextSplit = async () => {
    setLoading(true);
    try { await onNextSplit(); }
    finally { setLoading(false); }
  };

  const isChampion = champion && userTeam && champion.id === userTeam.id;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(5,8,20,0.97)",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "flex-start",
        padding: "2rem 1rem", overflowY: "auto",
      }}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.08 }}
        style={{ width: "100%", maxWidth: 860 }}
      >
        {/* ── Header ── */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: isChampion ? 52 : 44, marginBottom: 6 }}>
            {isChampion ? "🏆" : "⚜️"}
          </div>
          <h1 style={{
            fontFamily: "'Barlow Condensed', sans-serif",
            fontSize: 34, fontWeight: 900,
            color: "var(--secondary)", letterSpacing: 4,
            textTransform: "uppercase", marginBottom: 4,
          }}>
            FIN — {currentLabel?.toUpperCase()}
          </h1>
          {lastEntry && (
            <p style={{ color: "var(--text-secondary)", fontSize: 13 }}>
              {lastEntry.playoffs_result}
              {champion && (
                <span style={{ color: "var(--secondary)", marginLeft: 8 }}>
                  · Champion : {champion.name}
                </span>
              )}
            </p>
          )}
        </div>

        {/* ── International result (if any) ── */}
        {international_result && (
          <InternationalBanner result={international_result} />
        )}

        {/* ── Multi-region grid ── */}
        {other_regions && Object.keys(other_regions).length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{
              fontFamily: "'Barlow Condensed', sans-serif",
              fontSize: 11, color: "var(--text-secondary)",
              letterSpacing: 2, textTransform: "uppercase",
              marginBottom: 10,
            }}>
              🌐 Champions par région
            </div>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(5, 1fr)",
              gap: 8,
            }}>
              {["LEC", "LCK", "LPL", "LCS", "CBLOL"].map(league => (
                <RegionCard
                  key={league}
                  league={league}
                  data={other_regions[league]}
                  isHighlighted={league === userLeague}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Tabs: Récap / Historique ── */}
        <div style={{ display: "flex", gap: 2, marginBottom: 14 }}>
          {[["recap", "Récapitulatif"], ["history", "Carrière"]].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              style={{
                padding: "7px 18px",
                fontSize: 11, fontWeight: 700, letterSpacing: 1.5,
                textTransform: "uppercase",
                fontFamily: "'Barlow Condensed', sans-serif",
                border: "none", cursor: "pointer",
                borderRadius: "4px 4px 0 0",
                background: activeTab === key ? "var(--surface)" : "transparent",
                color: activeTab === key ? "var(--text-primary)" : "var(--text-secondary)",
                borderBottom: activeTab === key ? "2px solid var(--secondary)" : "2px solid transparent",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {activeTab === "recap" && (
            <motion.div
              key="recap"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              {/* stats grid */}
              {lastEntry && (
                <div style={{
                  display: "grid", gridTemplateColumns: "repeat(4,1fr)",
                  gap: 8, marginBottom: 16,
                }}>
                  {[
                    { label: "Bilan",      value: `${lastEntry.wins}V-${lastEntry.losses}D` },
                    { label: "Classement", value: `#${lastEntry.final_rank}` },
                    { label: "Budget",     value: `${formatMoney(lastEntry.budget)}€` },
                    { label: "Prestige",   value: lastEntry.prestige ?? userTeam?.prestige ?? "—" },
                  ].map(s => (
                    <div key={s.label} style={{
                      background: "var(--surface)",
                      border: "1px solid rgba(255,184,0,.2)",
                      borderRadius: 4, padding: "12px 8px", textAlign: "center",
                    }}>
                      <div style={{
                        fontFamily: "'Barlow Condensed',sans-serif",
                        fontSize: 22, fontWeight: 700, color: "var(--secondary)",
                      }}>{s.value}</div>
                      <div style={{
                        fontSize: 10, color: "var(--text-secondary)",
                        letterSpacing: 1, textTransform: "uppercase", marginTop: 2,
                      }}>{s.label}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* roster changes */}
              {roster_changes_preview && roster_changes_preview.length > 0 && next_split && (
                <div style={{
                  background: "var(--surface)",
                  border: "1px solid rgba(10,132,255,.15)",
                  borderRadius: 4, padding: 16, marginBottom: 16,
                }}>
                  <div style={{
                    fontFamily: "'Barlow Condensed',sans-serif",
                    fontSize: 11, color: "var(--primary)",
                    letterSpacing: 2, textTransform: "uppercase", marginBottom: 10,
                  }}>
                    Changements de roster → {nextLabel}
                  </div>
                  {roster_changes_preview.map((c, i) => (
                    <div key={i} style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "7px 0",
                      borderBottom: i < roster_changes_preview.length - 1
                        ? "1px solid rgba(255,255,255,.05)" : "none",
                      fontSize: 13,
                    }}>
                      {c.type === "info" ? (
                        <span style={{ color: "var(--text-secondary)" }}>{c.message}</span>
                      ) : (
                        <>
                          <span style={{
                            fontSize: 9, fontWeight: 800, letterSpacing: 1.5,
                            color: posColors[c.position] || "var(--secondary)",
                            minWidth: 32,
                          }}>{c.position}</span>
                          {c.type === "stay" ? (
                            <>
                              <span style={{
                                background: "rgba(0,230,118,.1)", color: "var(--success)",
                                border: "1px solid rgba(0,230,118,.2)",
                                fontSize: 9, padding: "1px 6px", borderRadius: 2,
                              }}>RESTE</span>
                              <span style={{ color: "var(--text-primary)", fontWeight: 700 }}>{c.player}</span>
                            </>
                          ) : (
                            <>
                              <span style={{
                                background: "rgba(255,51,102,.1)", color: "var(--danger)",
                                border: "1px solid rgba(255,51,102,.2)",
                                fontSize: 9, padding: "1px 6px", borderRadius: 2,
                              }}>PART</span>
                              <span style={{ color: "var(--text-secondary)", textDecoration: "line-through" }}>{c.out}</span>
                              <span style={{ color: "var(--text-secondary)" }}>→</span>
                              <span style={{
                                background: "rgba(0,230,118,.1)", color: "var(--success)",
                                border: "1px solid rgba(0,230,118,.2)",
                                fontSize: 9, padding: "1px 6px", borderRadius: 2,
                              }}>ARRIVE</span>
                              <span style={{ color: "var(--text-primary)", fontWeight: 700 }}>{c.in}</span>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                  <div style={{ marginTop: 10, fontSize: 11, color: "rgba(255,184,0,.5)", fontStyle: "italic" }}>
                    ⚠️ Votre roster personnel n'est pas affecté — seules les équipes adverses changent.
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === "history" && (
            <motion.div
              key="history"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <div style={{
                background: "var(--surface)",
                border: "1px solid rgba(10,132,255,.15)",
                borderRadius: 4, padding: 16, marginBottom: 16,
              }}>
                <div style={{
                  fontFamily: "'Barlow Condensed',sans-serif",
                  fontSize: 11, color: "var(--primary)",
                  letterSpacing: 2, textTransform: "uppercase", marginBottom: 10,
                }}>Historique de carrière</div>
                {history && history.length > 0 ? history.map((h, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "6px 0",
                    borderBottom: i < history.length - 1
                      ? "1px solid rgba(255,255,255,.05)" : "none",
                    fontSize: 12,
                  }}>
                    <span style={{ color: "var(--primary)", minWidth: 120, fontSize: 11 }}>{h.split_label}</span>
                    <span style={{ fontWeight: 700, color: "var(--text-secondary)", minWidth: 50 }}>{h.team_abbr}</span>
                    <span style={{ color: "var(--success)" }}>{h.wins}V</span>
                    <span style={{ color: "var(--danger)" }}>{h.losses}D</span>
                    <span style={{
                      marginLeft: "auto",
                      background: h.is_champion ? "rgba(255,184,0,.15)" : "rgba(10,132,255,.1)",
                      color: h.is_champion ? "var(--secondary)" : "var(--primary)",
                      border: `1px solid ${h.is_champion ? "rgba(255,184,0,.3)" : "rgba(10,132,255,.2)"}`,
                      fontSize: 10, padding: "1px 8px", borderRadius: 2,
                    }}>{h.playoffs_result}</span>
                  </div>
                )) : (
                  <div style={{ color: "var(--text-secondary)", fontSize: 12, textAlign: "center", padding: "12px 0" }}>
                    Aucune donnée de carrière disponible.
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Actions ── */}
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", marginTop: 8 }}>
          <motion.button
            onClick={handleNextSplit}
            disabled={loading}
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
            className="btn-primary"
            style={{ padding: "14px 32px", fontSize: 16, minWidth: 220 }}
          >
            {loading ? "Chargement..." : `▶ Jouer ${nextLabel || "le prochain split"}`}
          </motion.button>
          <motion.button
            onClick={onChangeTeam}
            disabled={loading}
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
            className="btn-secondary"
            style={{ padding: "14px 24px", fontSize: 16 }}
          >
            🔄 Changer d'équipe
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default SplitEndOverlay;
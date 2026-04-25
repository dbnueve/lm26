import React, { useState, useEffect, useMemo, useRef } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  ChartLine, Trophy, Calendar, Sword, Target,
  CheckCircle, XCircle, ChartBar, TrendUp, TrendDown,
} from "@phosphor-icons/react";
import TeamLogo from "./TeamLogo";
import { API_CLIENT } from "../shared";

/* ─── Tokens locaux (cohérent design system esports) ─────────── */
const FONT_HEADING = "'Russo One', 'Chakra Petch', system-ui, sans-serif";
const FONT_STATS   = "'Chakra Petch', 'Courier New', monospace";
const ACCENT_WIN   = "var(--success)";
const ACCENT_LOSS  = "var(--danger)";
const ACCENT_MVP   = "var(--amber)";
const ACCENT       = "var(--accent)";

/* ─── Couleurs ELO selon tendance ────────────────────────────── */
const ELO_COLOR_DEFAULT = ACCENT_WIN;
const eloDeltaColor = (delta) => {
  if (delta > 0) return ACCENT_WIN;
  if (delta < 0) return ACCENT_LOSS;
  return "var(--text-2)";
};

/* ─── HeroStat : carte mini-stat hero ────────────────────────── */
function HeroStat({ icon: Icon, label, value, sub, color = "var(--text-1)", highlight = false }) {
  return (
    <div
      style={{
        flex: 1, minWidth: 160,
        padding: "16px 18px",
        background: highlight
          ? `linear-gradient(135deg, ${color}1a, transparent 65%), var(--surface-1)`
          : "var(--surface-1)",
        border: `1px solid ${highlight ? color + "55" : "var(--border)"}`,
        borderRadius: 6,
        boxShadow: highlight
          ? `0 0 0 1px ${color}22, 0 4px 14px rgba(0,0,0,0.4)`
          : "0 4px 14px rgba(0,0,0,0.3)",
        position: "relative", overflow: "hidden",
      }}
    >
      {highlight && (
        <div aria-hidden="true" style={{
          position: "absolute", top: 0, left: 0, width: 3, height: "100%",
          background: color, boxShadow: `0 0 8px ${color}aa`,
        }} />
      )}
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        fontSize: 10, color: "var(--text-2)", fontWeight: 700,
        letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 4,
      }}>
        <Icon size={12} weight="fill" />
        {label}
      </div>
      <div style={{
        fontFamily: FONT_STATS, fontSize: 30, fontWeight: 800,
        color, fontVariantNumeric: "tabular-nums",
        textShadow: highlight ? `0 0 12px ${color}55` : "none",
        lineHeight: 1,
      }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 10, color: "var(--text-2)", marginTop: 4, letterSpacing: 0.4 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

/* ─── Tab button HUD esports ─────────────────────────────────── */
function TabButton({ id, active, onClick, icon: Icon, label }) {
  return (
    <button
      role="tab"
      aria-selected={active}
      aria-controls={`panel-${id}`}
      id={`tab-${id}`}
      onClick={onClick}
      style={{
        position: "relative",
        display: "flex", alignItems: "center", gap: 8,
        padding: "10px 18px", minHeight: 44,
        background: active ? "rgba(34,197,94,0.08)" : "transparent",
        border: `1px solid ${active ? "rgba(34,197,94,0.4)" : "var(--border)"}`,
        borderRadius: 4,
        color: active ? ACCENT_WIN : "var(--text-2)",
        fontFamily: FONT_HEADING, fontSize: 12, letterSpacing: 1.2,
        textTransform: "uppercase", fontWeight: 700,
        cursor: "pointer",
        transition: "all 180ms ease",
        boxShadow: active ? `0 0 0 1px ${ACCENT_WIN}33, 0 0 12px ${ACCENT_WIN}22` : "none",
      }}
      onMouseEnter={e => {
        if (!active) {
          e.currentTarget.style.background = "rgba(255,255,255,0.04)";
          e.currentTarget.style.color = "var(--text-1)";
        }
      }}
      onMouseLeave={e => {
        if (!active) {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "var(--text-2)";
        }
      }}
    >
      <Icon size={16} weight={active ? "fill" : "regular"} />
      {label}
      {active && (
        <span aria-hidden="true" style={{
          position: "absolute", bottom: -1, left: "20%", right: "20%",
          height: 2, background: ACCENT_WIN,
          boxShadow: `0 0 8px ${ACCENT_WIN}`,
        }} />
      )}
    </button>
  );
}

/* ─── EloChart : graphe ELO avec zones tiers + hover ─────────── */
function EloChart({ data }) {
  const reduceMotion = useReducedMotion();
  const [hoverIdx, setHoverIdx] = useState(null);
  const svgRef = useRef(null);

  const W = 1000;
  const H = 320;
  const PAD_L = 56, PAD_R = 16, PAD_T = 24, PAD_B = 48;
  const PLOT_W = W - PAD_L - PAD_R;
  const PLOT_H = H - PAD_T - PAD_B;

  const eloValues = data.map(d => d.elo).filter(v => v != null);
  const maxElo = (eloValues.length > 0 ? Math.max(...eloValues) : 1100) + 30;
  const minElo = (eloValues.length > 0 ? Math.min(...eloValues) : 900) - 30;

  const xOf = (i) => PAD_L + (data.length > 1 ? (i / (data.length - 1)) * PLOT_W : PLOT_W / 2);
  const yOf = (elo) => PAD_T + (1 - (elo - minElo) / (maxElo - minElo)) * PLOT_H;

  const linePoints = data.map((d, i) => `${xOf(i)},${yOf(d.elo)}`).join(" ");
  const areaPath = data.length > 0
    ? `M ${xOf(0)} ${PAD_T + PLOT_H} ` +
      data.map((d, i) => `L ${xOf(i)} ${yOf(d.elo)}`).join(" ") +
      ` L ${xOf(data.length - 1)} ${PAD_T + PLOT_H} Z`
    : "";

  // Y ticks (5 paliers)
  const yTicks = useMemo(() => {
    const ticks = [];
    const step = (maxElo - minElo) / 4;
    for (let i = 0; i <= 4; i++) {
      const v = Math.round(minElo + step * i);
      ticks.push({ v, y: yOf(v) });
    }
    return ticks;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxElo, minElo]);

  const onMove = (e) => {
    const svg = svgRef.current;
    if (!svg || data.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let bestIdx = 0, bestDist = Infinity;
    data.forEach((d, i) => {
      const dist = Math.abs(xOf(i) - px);
      if (dist < bestDist) { bestDist = dist; bestIdx = i; }
    });
    setHoverIdx(bestIdx);
  };

  const hoverPoint = hoverIdx != null ? data[hoverIdx] : null;
  const hoverTier  = hoverPoint ? getEloTier(hoverPoint.elo) : null;

  if (data.length === 0) {
    return (
      <div style={{
        height: 320, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        color: "var(--text-2)", gap: 12,
      }}>
        <ChartLine size={48} style={{ opacity: 0.3 }} />
        <p style={{ fontFamily: FONT_HEADING, letterSpacing: 1, fontSize: 12, textTransform: "uppercase" }}>
          Aucun historique ELO disponible
        </p>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ display: "block", overflow: "visible", height: 320 }}
        onMouseMove={onMove}
        onMouseLeave={() => setHoverIdx(null)}
        role="img"
        aria-label="Évolution de l'ELO par split"
      >
        <defs>
          <linearGradient id="eloAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"  stopColor={ACCENT_WIN} stopOpacity="0.45" />
            <stop offset="100%" stopColor={ACCENT_WIN} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Zones tiers (bandes horizontales colorées très subtiles) */}
        {ELO_TIERS.filter(t => t.min >= minElo && t.min <= maxElo).map((t, i) => (
          <line
            key={`tier-${i}`}
            x1={PAD_L} x2={W - PAD_R}
            y1={yOf(t.min)} y2={yOf(t.min)}
            stroke={t.color} strokeWidth="0.5" strokeDasharray="2 5" opacity="0.45"
          />
        ))}

        {/* Y ticks (grille principale) */}
        {yTicks.map((t, i) => (
          <g key={`y-${i}`}>
            <line
              x1={PAD_L} x2={W - PAD_R}
              y1={t.y} y2={t.y}
              stroke="rgba(255,255,255,0.05)" strokeWidth="1"
            />
            <text
              x={PAD_L - 10} y={t.y}
              textAnchor="end" dominantBaseline="middle"
              fill="var(--text-2)"
              fontSize="11"
              fontFamily={FONT_STATS}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {t.v}
            </text>
          </g>
        ))}

        {/* X ticks (labels splits) */}
        {data.map((d, i) => (
          <text
            key={`x-${i}`}
            x={xOf(i)} y={H - PAD_B + 18}
            textAnchor="middle"
            fill="var(--text-2)"
            fontSize="10"
            fontFamily={FONT_STATS}
            style={{ letterSpacing: 0.4, textTransform: "uppercase" }}
          >
            {d.split_label || `S${d.season || ""}.${d.split_number || i + 1}`}
          </text>
        ))}

        {/* Aire sous la courbe */}
        <path d={areaPath} fill="url(#eloAreaGrad)" />

        {/* Ligne ELO */}
        {data.length > 1 && (
          <polyline
            fill="none"
            stroke={ACCENT_WIN}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={linePoints}
            style={reduceMotion ? {} : {
              strokeDasharray: 3000,
              strokeDashoffset: 3000,
              animation: "eloLineDraw 1100ms ease-out forwards",
            }}
          />
        )}

        {/* Points */}
        {data.map((d, i) => {
          const isHover = hoverIdx === i;
          return (
            <circle
              key={`pt-${i}`}
              cx={xOf(i)} cy={yOf(d.elo)}
              r={isHover ? 7 : 5}
              fill="var(--surface-1)"
              stroke={getEloColor(d.elo)}
              strokeWidth={isHover ? 3 : 2.5}
              style={{
                filter: isHover ? `drop-shadow(0 0 6px ${getEloColor(d.elo)})` : "none",
                transition: "r 160ms, stroke-width 160ms",
              }}
            />
          );
        })}

        {/* Hover : ligne verticale */}
        {hoverPoint && (
          <line
            x1={xOf(hoverIdx)} x2={xOf(hoverIdx)}
            y1={PAD_T} y2={H - PAD_B}
            stroke="rgba(255,255,255,0.25)" strokeWidth="1" strokeDasharray="3 3"
            style={{ pointerEvents: "none" }}
          />
        )}
      </svg>

      {/* Tooltip HTML */}
      {hoverPoint && (
        <div style={{
          position: "absolute",
          top: 8,
          left: `calc(${(xOf(hoverIdx) / W) * 100}%)`,
          transform: "translateX(-50%)",
          padding: "8px 12px",
          background: "rgba(2,6,23,0.96)",
          border: `1px solid ${hoverTier.color}66`,
          borderRadius: 4,
          boxShadow: `0 6px 20px rgba(0,0,0,0.6), 0 0 12px ${hoverTier.color}22`,
          backdropFilter: "blur(8px)",
          pointerEvents: "none",
          whiteSpace: "nowrap",
          zIndex: 5,
        }}>
          <div style={{
            fontFamily: FONT_HEADING, fontSize: 11,
            color: hoverTier.color, letterSpacing: 1, textTransform: "uppercase",
          }}>
            {hoverPoint.split_label || `Split ${hoverPoint.split_number}`}
          </div>
          <div style={{
            fontFamily: FONT_STATS, fontSize: 18, fontWeight: 800,
            color: "var(--text-1)", fontVariantNumeric: "tabular-nums", lineHeight: 1.1,
          }}>
            {hoverPoint.elo.toFixed(0)}
            <span style={{ fontSize: 10, color: hoverTier.color, marginLeft: 6 }}>
              {hoverTier.label}
            </span>
          </div>
          {(hoverPoint.wins != null || hoverPoint.losses != null) && (
            <div style={{
              fontSize: 10, color: "var(--text-2)", marginTop: 2,
              fontFamily: FONT_STATS, fontVariantNumeric: "tabular-nums",
            }}>
              <span style={{ color: ACCENT_WIN }}>{hoverPoint.wins || 0}V</span>
              {" — "}
              <span style={{ color: ACCENT_LOSS }}>{hoverPoint.losses || 0}D</span>
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes eloLineDraw {
          to { stroke-dashoffset: 0; }
        }
      `}</style>
    </div>
  );
}

/* ─── Composant principal ────────────────────────────────────── */
const HistoryPage = ({ userTeam, showToast }) => {
  const reduceMotion = useReducedMotion();

  const [eloHistory, setEloHistory] = useState(null);
  const [splitStats, setSplitStats] = useState(null);
  const [headToHead, setHeadToHead] = useState(null);
  const [activeTab, setActiveTab] = useState("elo");
  const [selectedSplit, setSelectedSplit] = useState("current");
  const [selectedOpponent, setSelectedOpponent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [teams, setTeams] = useState([]);

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [eloRes, teamsRes, splitRes] = await Promise.all([
        API_CLIENT.get(`/career/elo-history`),
        API_CLIENT.get(`/teams`),
        API_CLIENT.get(`/career/split-stats`, { params: { split: selectedSplit } }),
      ]);
      setEloHistory(eloRes.data);
      setTeams(teamsRes.data.filter(t => t.id !== userTeam.id));
      setSplitStats(splitRes.data);
    } catch (e) {
      showToast("Erreur lors du chargement des données", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleOpponentSelect = async (opponentId) => {
    if (!opponentId) return;
    setSelectedOpponent(opponentId);
    try {
      const res = await API_CLIENT.get(`/career/head-to-head/${userTeam.id}/${opponentId}`);
      setHeadToHead(res.data);
    } catch (e) {
      showToast("Erreur lors du chargement du duel", "error");
    }
  };

  const handleSplitChange = async (splitKey) => {
    setSelectedSplit(splitKey);
    try {
      const res = await API_CLIENT.get(`/career/split-stats`, { params: { split: splitKey } });
      setSplitStats(res.data);
    } catch (e) {
      console.error(e);
    }
  };

  // --- Calculs ---
  const globalStats = useMemo(() => {
    if (!eloHistory?.history) return { wins: 0, losses: 0, rate: 0, total: 0 };
    const totalWins = eloHistory.history.reduce((sum, h) => sum + (h.wins || 0), 0);
    const totalLosses = eloHistory.history.reduce((sum, h) => sum + (h.losses || 0), 0);
    const total = totalWins + totalLosses;
    return {
      wins: totalWins,
      losses: totalLosses,
      total,
      rate: total > 0 ? Math.round((totalWins / total) * 100) : 0,
    };
  }, [eloHistory]);

  const eloChartData = useMemo(() => {
    if (!eloHistory?.history) return [];
    return [...eloHistory.history]
      .filter(d => d.elo != null)
      .sort((a, b) => a.season !== b.season ? a.season - b.season : a.split_number - b.split_number);
  }, [eloHistory]);

  const currentElo = eloHistory?.current_team?.elo;
  const peakElo = eloChartData.length > 0 ? Math.max(...eloChartData.map(d => d.elo)) : null;
  const eloDelta = useMemo(() => {
    if (eloChartData.length < 2) return 0;
    return Math.round(eloChartData[eloChartData.length - 1].elo - eloChartData[0].elo);
  }, [eloChartData]);

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 60 }}>
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="animate-slide-up">
      {/* ─── Header ─────────────────────────────────────────────── */}
      <header style={{ marginBottom: 24 }}>
        <h2 style={{
          margin: 0,
          fontFamily: FONT_HEADING, fontSize: 32, letterSpacing: 2,
          display: "flex", alignItems: "center", gap: 12,
          color: "var(--text-1)",
        }}>
          <ChartLine size={28} weight="fill" style={{ color: ACCENT_WIN }} />
          Historique &amp; Statistiques
        </h2>
        <p style={{
          margin: "4px 0 0 40px",
          fontSize: 12, color: "var(--text-2)",
          letterSpacing: 0.6, textTransform: "uppercase", fontWeight: 600,
        }}>
          Évolution ELO · Splits · Duels
        </p>
      </header>

      {/* ─── Hero stats (toujours visibles) ─────────────────────── */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <HeroStat
          icon={ChartLine}
          label="ELO Actuel"
          value={currentElo ? currentElo.toFixed(0) : "—"}
          color={ELO_COLOR_DEFAULT}
          highlight
        />
        <HeroStat
          icon={Trophy}
          label="Winrate"
          value={`${globalStats.rate}%`}
          sub={`${globalStats.wins}V — ${globalStats.losses}D`}
          color={globalStats.rate >= 50 ? ACCENT_WIN : ACCENT_LOSS}
        />
        <HeroStat
          icon={Target}
          label="Pic ELO"
          value={peakElo ? peakElo.toFixed(0) : "—"}
          color={ACCENT_MVP}
        />
        <HeroStat
          icon={eloDelta >= 0 ? TrendUp : TrendDown}
          label="Tendance"
          value={`${eloDelta >= 0 ? "+" : ""}${eloDelta}`}
          sub={`${globalStats.total} matchs joués`}
          color={eloDelta >= 0 ? ACCENT_WIN : ACCENT_LOSS}
        />
      </div>

      {/* ─── Tabs ───────────────────────────────────────────────── */}
      <div role="tablist" style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        <TabButton id="elo"        active={activeTab === "elo"}        onClick={() => setActiveTab("elo")}        icon={ChartLine} label="Évolution ELO" />
        <TabButton id="splits"     active={activeTab === "splits"}     onClick={() => setActiveTab("splits")}     icon={Calendar}  label="Stats par Split" />
        <TabButton id="headtohead" active={activeTab === "headtohead"} onClick={() => setActiveTab("headtohead")} icon={Sword}    label="Head-to-Head" />
      </div>

      {/* ─── Panel ELO ─────────────────────────────────────────── */}
      {activeTab === "elo" && (
        <motion.section
          {...(reduceMotion ? {} : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.25 } })}
          role="tabpanel"
          id="panel-elo" aria-labelledby="tab-elo"
          className="card"
          style={{ padding: 20 }}
        >
          <div style={{ marginBottom: 16 }}>
            <h3 style={{
              margin: 0, fontFamily: FONT_HEADING, fontSize: 14, letterSpacing: 2,
              color: "var(--text-2)", textTransform: "uppercase",
            }}>
              Évolution par split
            </h3>
          </div>
          <EloChart data={eloChartData} />
        </motion.section>
      )}

      {/* ─── Panel Splits ──────────────────────────────────────── */}
      {activeTab === "splits" && (
        <motion.section
          {...(reduceMotion ? {} : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.25 } })}
          role="tabpanel"
          id="panel-splits" aria-labelledby="tab-splits"
          className="card"
          style={{ padding: 20 }}
        >
          <h3 style={{
            margin: "0 0 12px 0",
            fontFamily: FONT_HEADING, fontSize: 14, letterSpacing: 2,
            color: "var(--text-2)", textTransform: "uppercase",
          }}>
            Sélection du split
          </h3>
          <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
            {eloHistory?.history?.map(h => {
              const isActive = selectedSplit === h.split_key;
              return (
                <button
                  key={h.split_key}
                  onClick={() => handleSplitChange(h.split_key)}
                  style={{
                    padding: "8px 14px", minHeight: 36,
                    background: isActive ? "rgba(34,197,94,0.12)" : "var(--surface-1)",
                    border: `1px solid ${isActive ? ACCENT_WIN : "var(--border)"}`,
                    borderRadius: 4,
                    color: isActive ? ACCENT_WIN : "var(--text-2)",
                    fontFamily: FONT_HEADING, fontSize: 11, letterSpacing: 1,
                    textTransform: "uppercase", fontWeight: 700,
                    cursor: "pointer",
                    transition: "all 160ms ease",
                    boxShadow: isActive ? `0 0 8px ${ACCENT_WIN}33` : "none",
                  }}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.color = "var(--text-1)"; }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.color = "var(--text-2)"; }}
                >
                  {h.split_label}
                </button>
              );
            })}
          </div>

          {splitStats ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
              <SplitStatCard
                icon={Trophy}
                label="Classement final"
                value={`#${splitStats.user_team?.final_rank || "?"}`}
                color={ACCENT_MVP}
              />
              <SplitStatCard
                icon={CheckCircle}
                label="Bilan"
                value={`${splitStats.user_team?.wins || 0}V — ${splitStats.user_team?.losses || 0}D`}
                color={ACCENT_WIN}
              />
              <SplitStatCard
                icon={ChartBar}
                label="Winrate"
                value={
                  (splitStats.user_team?.wins + splitStats.user_team?.losses) > 0
                    ? `${Math.round((splitStats.user_team.wins / (splitStats.user_team.wins + splitStats.user_team.losses)) * 100)}%`
                    : "—"
                }
                color={ACCENT}
              />
              <SplitStatCard
                icon={ChartLine}
                label="ELO du split"
                value={splitStats.user_team?.elo ? splitStats.user_team.elo.toFixed(0) : "—"}
                color={splitStats.user_team?.elo ? getEloColor(splitStats.user_team.elo) : "var(--text-2)"}
              />
            </div>
          ) : (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text-2)" }}>
              <Calendar size={36} style={{ opacity: 0.3 }} />
              <p style={{ marginTop: 12, fontSize: 12 }}>Sélectionnez un split pour voir les statistiques</p>
            </div>
          )}
        </motion.section>
      )}

      {/* ─── Panel Head-to-Head ────────────────────────────────── */}
      {activeTab === "headtohead" && (
        <motion.section
          {...(reduceMotion ? {} : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.25 } })}
          role="tabpanel"
          id="panel-headtohead" aria-labelledby="tab-headtohead"
          className="card"
          style={{ padding: 20 }}
        >
          <label htmlFor="opponent-select" style={{
            display: "block", marginBottom: 8,
            fontFamily: FONT_HEADING, fontSize: 12, letterSpacing: 1.5,
            color: "var(--text-2)", textTransform: "uppercase", fontWeight: 700,
          }}>
            Sélectionnez un rival
          </label>
          <select
            id="opponent-select"
            value={selectedOpponent || ""}
            onChange={(e) => handleOpponentSelect(e.target.value)}
            style={{
              width: "100%", padding: "12px 14px", minHeight: 44,
              borderRadius: 4,
              background: "var(--surface-1)",
              border: "1px solid var(--border)",
              color: "var(--text-1)",
              fontFamily: FONT_STATS, fontSize: 14,
              cursor: "pointer",
              outline: "none",
              transition: "border 160ms ease, box-shadow 160ms ease",
            }}
            onFocus={e => e.currentTarget.style.boxShadow = `0 0 0 2px ${ACCENT_WIN}55`}
            onBlur={e => e.currentTarget.style.boxShadow = "none"}
          >
            <option value="">— Choisir une équipe —</option>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name} ({t.abbr})</option>)}
          </select>

          {headToHead ? (
            <div className="animate-fade-in" style={{ marginTop: 24 }}>
              <HeadToHeadDuel
                t1={headToHead.team1}
                t2={headToHead.team2}
                w1={headToHead.record.team1_wins}
                w2={headToHead.record.team2_wins}
                p1={headToHead.record.win_probability.team1}
                p2={headToHead.record.win_probability.team2}
              />

              {/* Liste des matchs */}
              <h4 style={{
                margin: "24px 0 10px 0",
                fontFamily: FONT_HEADING, fontSize: 12, letterSpacing: 2,
                color: "var(--text-2)", textTransform: "uppercase",
              }}>
                Dernières confrontations
              </h4>
              {headToHead.matches?.length ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {headToHead.matches.map(m => (
                    <MatchRow key={m.id} match={m} userTeamId={userTeam.id} />
                  ))}
                </div>
              ) : (
                <div style={{ padding: 24, textAlign: "center", color: "var(--text-2)", fontSize: 12 }}>
                  Aucun match enregistré entre les deux équipes
                </div>
              )}
            </div>
          ) : (
            <div style={{
              marginTop: 24, padding: "48px 24px", textAlign: "center",
              color: "var(--text-2)",
              border: "1px dashed var(--border)", borderRadius: 6,
            }}>
              <Sword size={48} style={{ opacity: 0.25, marginBottom: 12 }} />
              <p style={{ margin: 0, fontFamily: FONT_HEADING, fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase" }}>
                Choisissez un adversaire pour analyser les duels
              </p>
            </div>
          )}
        </motion.section>
      )}
    </div>
  );
};

/* ─── SplitStatCard ──────────────────────────────────────────── */
function SplitStatCard({ icon: Icon, label, value, color }) {
  return (
    <div style={{
      padding: 16,
      background: "var(--surface-1)",
      border: "1px solid var(--border)",
      borderRadius: 6,
      borderLeft: `3px solid ${color}`,
      boxShadow: "0 4px 14px rgba(0,0,0,0.3)",
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        fontSize: 10, color: "var(--text-2)", fontWeight: 700,
        letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 6,
      }}>
        <Icon size={14} weight="fill" style={{ color }} />
        {label}
      </div>
      <div style={{
        fontFamily: FONT_STATS, fontSize: 22, fontWeight: 800,
        color, fontVariantNumeric: "tabular-nums", lineHeight: 1.1,
      }}>
        {value}
      </div>
    </div>
  );
}

/* ─── HeadToHeadDuel : score + barre de probabilité ──────────── */
function HeadToHeadDuel({ t1, t2, w1, w2, p1, p2 }) {
  const t1Lead = w1 > w2;
  const t2Lead = w2 > w1;
  return (
    <div>
      {/* Score line */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 16, marginBottom: 24,
      }}>
        <div style={{ flex: 1, textAlign: "center" }}>
          <TeamLogo teamId={t1.id} abbr={t1.abbr} size={56} />
          <div style={{
            fontFamily: FONT_HEADING, fontSize: 13, letterSpacing: 1,
            color: t1Lead ? ACCENT_WIN : "var(--text-1)", marginTop: 4,
          }}>{t1.abbr}</div>
          <div style={{ fontSize: 10, color: "var(--text-2)" }}>{t1.name}</div>
        </div>

        <div style={{
          display: "flex", alignItems: "center", gap: 14,
          fontFamily: FONT_STATS, fontWeight: 900,
          fontVariantNumeric: "tabular-nums",
        }}>
          <span style={{
            fontSize: 56, lineHeight: 1,
            color: t1Lead ? ACCENT_WIN : "var(--text-1)",
            textShadow: t1Lead ? `0 0 16px ${ACCENT_WIN}88` : "none",
          }}>{w1}</span>
          <span style={{ fontSize: 22, color: "var(--text-2)" }}>:</span>
          <span style={{
            fontSize: 56, lineHeight: 1,
            color: t2Lead ? ACCENT_LOSS : "var(--text-1)",
            textShadow: t2Lead ? `0 0 16px ${ACCENT_LOSS}88` : "none",
          }}>{w2}</span>
        </div>

        <div style={{ flex: 1, textAlign: "center" }}>
          <TeamLogo teamId={t2.id} abbr={t2.abbr} size={56} />
          <div style={{
            fontFamily: FONT_HEADING, fontSize: 13, letterSpacing: 1,
            color: t2Lead ? ACCENT_LOSS : "var(--text-1)", marginTop: 4,
          }}>{t2.abbr}</div>
          <div style={{ fontSize: 10, color: "var(--text-2)" }}>{t2.name}</div>
        </div>
      </div>

      {/* Barre de probabilité */}
      <div>
        <div style={{
          display: "flex", justifyContent: "space-between",
          fontFamily: FONT_STATS, fontSize: 11, fontWeight: 700,
          letterSpacing: 0.6, marginBottom: 6,
          fontVariantNumeric: "tabular-nums",
        }}>
          <span style={{ color: ACCENT_WIN }}>{p1.toFixed(0)}%</span>
          <span style={{
            fontFamily: FONT_HEADING, color: "var(--text-2)",
            letterSpacing: 1.5, textTransform: "uppercase", fontSize: 9,
          }}>
            Chances de victoire
          </span>
          <span style={{ color: ACCENT_LOSS }}>{p2.toFixed(0)}%</span>
        </div>
        <div
          role="progressbar"
          aria-valuenow={p1}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Probabilité de victoire ${t1.abbr} ${p1.toFixed(0)}%`}
          style={{
            height: 8, borderRadius: 2, overflow: "hidden",
            background: "rgba(255,255,255,0.06)",
            display: "flex",
            boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.05)",
          }}
        >
          <div style={{
            width: `${p1}%`, height: "100%",
            background: `linear-gradient(90deg, ${ACCENT_WIN}, ${ACCENT_WIN}aa)`,
            boxShadow: `0 0 8px ${ACCENT_WIN}88`,
            transition: "width 480ms ease-out",
          }} />
          <div style={{
            width: `${p2}%`, height: "100%",
            background: `linear-gradient(270deg, ${ACCENT_LOSS}, ${ACCENT_LOSS}aa)`,
            boxShadow: `0 0 8px ${ACCENT_LOSS}88`,
            transition: "width 480ms ease-out",
          }} />
        </div>
      </div>
    </div>
  );
}

/* ─── MatchRow : ligne de match dans Head-to-Head ────────────── */
function MatchRow({ match, userTeamId }) {
  const userWon = match.winner === userTeamId;
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "auto 70px 1fr 70px",
      alignItems: "center", gap: 12,
      padding: "10px 14px",
      background: "var(--surface-1)",
      border: `1px solid ${userWon ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.15)"}`,
      borderLeft: `3px solid ${userWon ? ACCENT_WIN : ACCENT_LOSS}`,
      borderRadius: 4,
      transition: "background 160ms ease",
    }}
      onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.03)"}
      onMouseLeave={e => e.currentTarget.style.background = "var(--surface-1)"}
    >
      <span style={{
        fontFamily: FONT_HEADING, fontSize: 10, letterSpacing: 1,
        color: "var(--text-2)", textTransform: "uppercase",
      }}>
        S{match.week}
      </span>
      <span style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4,
        padding: "3px 8px", borderRadius: 2,
        background: userWon ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.12)",
        color: userWon ? ACCENT_WIN : ACCENT_LOSS,
        fontFamily: FONT_HEADING, fontSize: 10, letterSpacing: 1,
        fontWeight: 800, textTransform: "uppercase",
      }}>
        {userWon
          ? <><CheckCircle size={11} weight="fill" /> V</>
          : <><XCircle size={11} weight="fill" /> D</>}
      </span>
      <span style={{
        textAlign: "center",
        fontFamily: FONT_STATS, fontSize: 16, fontWeight: 800,
        fontVariantNumeric: "tabular-nums",
      }}>
        <span style={{ color: userWon ? ACCENT_WIN : "var(--text-2)" }}>{match.score1}</span>
        <span style={{ color: "var(--text-2)", margin: "0 6px" }}>—</span>
        <span style={{ color: !userWon ? ACCENT_WIN : "var(--text-2)" }}>{match.score2}</span>
      </span>
      <span style={{
        textAlign: "right",
        fontSize: 10, color: "var(--text-2)",
        fontFamily: FONT_STATS,
      }}>
        {match.date || ""}
      </span>
    </div>
  );
}

export default HistoryPage;

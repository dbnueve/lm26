import React, { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Trophy, Star, ArrowLeft, Crosshair, Sword, Coins, Timer, Crown,
} from "@phosphor-icons/react";
import TeamLogo from "./TeamLogo";
import { _ddVersion, toDDragonKey } from "./ddHelpers";
import { calcNote } from "./timelineHelpers";

/* ─── Tokens locaux (cohérent design system esports) ─────────── */
const FONT_HEADING = "'Russo One', 'Chakra Petch', system-ui, sans-serif";
const FONT_STATS   = "'Chakra Petch', 'Courier New', monospace";
const ACCENT_WIN   = "var(--success)";
const ACCENT_LOSS  = "var(--danger)";
const ACCENT_MVP   = "var(--amber)";

/* ─── Mini stat block (icône + label + valeur) ──────────────── */
function MiniStat({ icon: Icon, label, value, color = "var(--text-1)" }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
      minWidth: 64,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--text-2)" }}>
        <Icon size={11} weight="fill" />
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
        }}>{label}</span>
      </div>
      <span style={{
        fontFamily: FONT_STATS, fontSize: 18, fontWeight: 800, lineHeight: 1,
        color, fontVariantNumeric: "tabular-nums",
      }}>{value}</span>
    </div>
  );
}

function getMVP(matchResult, userTeamId) {
  if (!matchResult?.match_details) return null;
  const team1Stats = matchResult.match_details.team1_stats || [];
  const team2Stats = matchResult.match_details.team2_stats || [];
  const allStats = [...team1Stats, ...team2Stats];
  const dur = matchResult.match_details.duration || 1;
  const won = (teamNum, stat) => {
    // MVP calc: use userTeam perspective win bonus only if this player is on winning team.
    // Since MVP is global (both teams), use winner match field for fairness.
    return matchResult.winner && stat._onWinner;
  };
  // Tag players with their team-winner status
  team1Stats.forEach(p => { p._onWinner = matchResult.match_details.winner === 1; });
  team2Stats.forEach(p => { p._onWinner = matchResult.match_details.winner === 2; });

  let mvp = null;
  let maxScore = -Infinity;
  allStats.forEach(p => {
    const score = calcNote(p, dur, !!p._onWinner);
    if (score > maxScore) {
      maxScore = score;
      mvp = p;
    }
  });
  return mvp;
}

function StatRow({ p, duration, won, maxDamage }) {
  const note = calcNote(p, duration, won);
  const isGood = note >= 7, isBad = note <= 3;
  const dur = Math.max(duration || 1, 1);
  const dmgPct = maxDamage > 0 ? Math.min(100, ((p.damage || 0) / maxDamage) * 100) : 0;
  const noteColor = isGood ? "var(--success)" : isBad ? "var(--danger)" : "var(--accent)";

  return (
    <div
      role="row"
      style={{
        display: "grid",
        gridTemplateColumns: "32px 1fr 78px 44px 52px 96px",
        padding: "8px 12px",
        borderTop: "1px solid var(--border)",
        alignItems: "center",
        gap: 6,
        transition: "background 180ms ease",
      }}
      onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
    >
      {p.champion ? (
        <img loading="lazy"
          src={`https://ddragon.leagueoflegends.com/cdn/${_ddVersion}/img/champion/${toDDragonKey(p.champion)}.png`}
          alt={`Champion ${p.champion}`} title={p.champion}
          style={{
            width: 28, height: 28, borderRadius: 3,
            border: `1px solid ${won ? "rgba(34,197,94,0.4)" : "rgba(239,68,68,0.3)"}`,
          }}
          onError={e => { e.currentTarget.style.display = "none"; }}
        />
      ) : <span aria-hidden="true" />}

      <div style={{ minWidth: 0 }}>
        <div style={{
          fontWeight: 600, fontSize: 13, lineHeight: 1.2,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {p.player_name || p.position}
        </div>
        <div style={{
          fontSize: 9, color: "var(--text-2)", letterSpacing: 0.6,
          textTransform: "uppercase", fontWeight: 700,
        }}>
          {p.position}
        </div>
      </div>

      <span style={{
        textAlign: "center", fontFamily: FONT_STATS, fontWeight: 700, fontSize: 13,
        fontVariantNumeric: "tabular-nums",
      }}>
        <span style={{ color: "var(--success)" }}>{p.kills}</span>
        <span style={{ color: "var(--text-2)", margin: "0 1px" }}>/</span>
        <span style={{ color: "var(--danger)" }}>{p.deaths}</span>
        <span style={{ color: "var(--text-2)", margin: "0 1px" }}>/</span>
        <span style={{ color: "var(--accent)" }}>{p.assists}</span>
      </span>

      <span style={{
        textAlign: "center", fontFamily: FONT_STATS, fontWeight: 800, fontSize: 14,
        color: noteColor,
        textShadow: isGood ? `0 0 8px ${noteColor}55` : "none",
      }}>
        {note.toFixed(1)}
      </span>

      <span style={{
        textAlign: "center", fontFamily: FONT_STATS, fontSize: 12,
        color: "var(--text-1)", fontVariantNumeric: "tabular-nums",
      }}>
        {((p.cs || 0) / dur).toFixed(1)}
      </span>

      {/* Barre DMG comparative */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span style={{
          fontFamily: FONT_STATS, fontSize: 11, fontWeight: 700, color: "var(--amber)",
          textAlign: "right", fontVariantNumeric: "tabular-nums",
        }}>
          {p.damage ? (p.damage / 1000).toFixed(1) + "k" : "—"}
        </span>
        <div
          role="presentation"
          aria-label={`Dégâts ${p.damage || 0}`}
          style={{
            height: 3, borderRadius: 2,
            background: "rgba(255,255,255,0.06)",
            overflow: "hidden",
          }}
        >
          <div style={{
            width: `${dmgPct}%`, height: "100%",
            background: "linear-gradient(90deg, var(--amber), #f97316)",
            boxShadow: "0 0 6px rgba(255,184,0,0.45)",
            transition: "width 400ms ease-out",
          }} />
        </div>
      </div>
    </div>
  );
}

function TeamStatsCard({ stats, won, teamId, teamAbbr, teamName, duration, totalGold }) {
  const accent = won ? ACCENT_WIN : ACCENT_LOSS;
  const maxDamage = useMemo(
    () => Math.max(0, ...stats.map(p => p.damage || 0)),
    [stats]
  );
  const totalKills   = stats.reduce((a, p) => a + (p.kills || 0), 0);
  const totalDeaths  = stats.reduce((a, p) => a + (p.deaths || 0), 0);
  const totalAssists = stats.reduce((a, p) => a + (p.assists || 0), 0);

  return (
    <section
      className="card"
      style={{
        padding: 0, overflow: "hidden",
        border: `1px solid ${won ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.25)"}`,
        boxShadow: won
          ? "0 0 0 1px rgba(34,197,94,0.15), 0 8px 24px rgba(0,0,0,0.45)"
          : "0 8px 24px rgba(0,0,0,0.45)",
      }}
      aria-label={`Statistiques équipe ${teamAbbr}`}
    >
      {/* Header — bande accent + logo + nom + badge winner */}
      <header style={{
        position: "relative",
        padding: "10px 14px",
        display: "flex", alignItems: "center", gap: 10,
        background: `linear-gradient(90deg, ${won ? "rgba(34,197,94,0.18)" : "rgba(239,68,68,0.14)"}, transparent 70%)`,
        borderBottom: `1px solid ${accent}55`,
      }}>
        <div style={{
          width: 4, alignSelf: "stretch", background: accent,
          boxShadow: `0 0 8px ${accent}aa`,
        }} aria-hidden="true" />
        <TeamLogo teamId={teamId} abbr={teamAbbr} size={28} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: FONT_HEADING, fontSize: 16, fontWeight: 700,
            letterSpacing: 1, lineHeight: 1.1,
            color: "var(--text-1)",
          }}>
            {teamAbbr}
          </div>
          <div style={{
            fontSize: 10, color: "var(--text-2)", letterSpacing: 0.5,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {teamName || ""}
          </div>
        </div>
        {won && (
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            padding: "3px 8px", borderRadius: 3,
            background: ACCENT_WIN, color: "#021b0c",
            fontFamily: FONT_HEADING, fontSize: 10, fontWeight: 800,
            letterSpacing: 1.5, textTransform: "uppercase",
            boxShadow: `0 0 12px ${ACCENT_WIN}88`,
          }}>
            <Crown size={11} weight="fill" /> Victoire
          </span>
        )}
        <div style={{ display: "flex", gap: 14, marginLeft: 4 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", lineHeight: 1.05 }}>
            <span style={{
              fontFamily: FONT_STATS, fontSize: 14, fontWeight: 800,
              color: ACCENT_MVP, fontVariantNumeric: "tabular-nums",
            }}>
              {(totalGold / 1000).toFixed(1)}k
            </span>
            <span style={{
              fontSize: 8, color: "var(--text-2)", letterSpacing: 0.8,
              fontWeight: 700, textTransform: "uppercase",
            }}>Gold</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", lineHeight: 1.05 }}>
            <span style={{
              fontFamily: FONT_STATS, fontSize: 14, fontWeight: 800,
              fontVariantNumeric: "tabular-nums",
            }}>
              <span style={{ color: ACCENT_WIN }}>{totalKills}</span>
              <span style={{ color: "var(--text-2)", margin: "0 1px" }}>/</span>
              <span style={{ color: ACCENT_LOSS }}>{totalDeaths}</span>
              <span style={{ color: "var(--text-2)", margin: "0 1px" }}>/</span>
              <span style={{ color: "var(--accent)" }}>{totalAssists}</span>
            </span>
            <span style={{
              fontSize: 8, color: "var(--text-2)", letterSpacing: 0.8,
              fontWeight: 700, textTransform: "uppercase",
            }}>K/D/A</span>
          </div>
        </div>
      </header>

      <div role="table" style={{ padding: 4 }}>
        <div role="row" style={{
          display: "grid", gridTemplateColumns: "32px 1fr 78px 44px 52px 96px",
          padding: "8px 12px", fontSize: 9,
          color: "var(--text-2)", fontWeight: 700, letterSpacing: 1.2,
          textTransform: "uppercase", gap: 6,
        }}>
          <span aria-hidden="true" />
          <span>Joueur</span>
          <span style={{ textAlign: "center" }}>K / D / A</span>
          <span style={{ textAlign: "center" }}>Note</span>
          <span style={{ textAlign: "center" }}>CS/M</span>
          <span style={{ textAlign: "right" }}>Dégâts</span>
        </div>
        {stats.map((p, i) => (
          <StatRow key={i} p={p} duration={duration} won={won} maxDamage={maxDamage} />
        ))}
      </div>
    </section>
  );
}

/* ─── GoldDiffChart : graphe SVG gold diff (blue=team1, red=team2) ─ */
const BLUE = "#3b82f6";
const RED  = "#ef4444";

function GoldDiffChart({ goldTimeline, duration }) {
  const reduceMotion = useReducedMotion();
  const [hoverIdx, setHoverIdx] = React.useState(null);
  const svgRef = React.useRef(null);

  // Dimensions logiques (viewBox)
  const W = 800;
  const H = 200;
  const PAD_L = 48, PAD_R = 16, PAD_T = 16, PAD_B = 28;
  const PLOT_W = W - PAD_L - PAD_R;
  const PLOT_H = H - PAD_T - PAD_B;
  const MID_Y  = PAD_T + PLOT_H / 2;

  const data = useMemo(() => {
    return goldTimeline.map((g, i) => ({
      minute: g.minute != null ? g.minute : i,
      diff: (g.g1 || 0) - (g.g2 || 0), // > 0 = blue advantage
    }));
  }, [goldTimeline]);

  const maxAbs = useMemo(() => {
    const m = data.reduce((acc, d) => Math.max(acc, Math.abs(d.diff)), 0);
    return Math.max(1000, m); // floor pour pas écraser la courbe quand petit diff
  }, [data]);

  const lastMin = data.length ? data[data.length - 1].minute : Math.max(duration || 1, 1);
  const xMax = Math.max(lastMin, 1);

  const xOf = (m) => PAD_L + (m / xMax) * PLOT_W;
  const yOf = (diff) => MID_Y - (diff / maxAbs) * (PLOT_H / 2);

  // Path d'aire (top = blue advantage, bottom = red advantage)
  const pathD = useMemo(() => {
    if (data.length === 0) return "";
    let d = `M ${xOf(data[0].minute)} ${MID_Y}`;
    data.forEach(p => { d += ` L ${xOf(p.minute)} ${yOf(p.diff)}`; });
    d += ` L ${xOf(data[data.length - 1].minute)} ${MID_Y} Z`;
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, maxAbs, xMax]);

  // Path de la ligne (sans fermeture)
  const lineD = useMemo(() => {
    if (data.length === 0) return "";
    return data.map((p, i) =>
      `${i === 0 ? "M" : "L"} ${xOf(p.minute)} ${yOf(p.diff)}`
    ).join(" ");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, maxAbs, xMax]);

  // Ticks Y (gold)
  const yTicks = useMemo(() => {
    const step = maxAbs / 2;
    return [-maxAbs, -step, 0, step, maxAbs].map(v => ({
      v,
      y: yOf(v),
      label: v === 0 ? "0" : `${v > 0 ? "+" : "−"}${(Math.abs(v) / 1000).toFixed(0)}k`,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxAbs]);

  // Ticks X (toutes les 5 min)
  const xTicks = useMemo(() => {
    const ticks = [];
    for (let m = 0; m <= xMax; m += 5) ticks.push(m);
    if (ticks[ticks.length - 1] !== xMax) ticks.push(xMax);
    return ticks;
  }, [xMax]);

  // Hover handler
  const onMove = (e) => {
    const svg = svgRef.current;
    if (!svg || data.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const minute = ((px - PAD_L) / PLOT_W) * xMax;
    // closest point
    let bestIdx = 0, bestDist = Infinity;
    data.forEach((p, i) => {
      const d = Math.abs(p.minute - minute);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    });
    setHoverIdx(bestIdx);
  };

  const hoverPoint = hoverIdx != null ? data[hoverIdx] : null;
  const hoverLeader = hoverPoint ? (hoverPoint.diff > 0 ? "BLUE" : hoverPoint.diff < 0 ? "RED" : "—") : null;

  return (
    <section style={{ marginBottom: 20 }} aria-label="Évolution du gold diff dans le temps">
      <div style={{
        display: "flex", alignItems: "baseline", justifyContent: "space-between",
        marginBottom: 10,
      }}>
        <h3 style={{
          fontFamily: FONT_HEADING, fontSize: 12, letterSpacing: 2,
          color: "var(--text-2)", textTransform: "uppercase",
          margin: 0,
        }}>
          Évolution du gold
        </h3>
        <div style={{ display: "flex", gap: 14, fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: BLUE }}>
            <span style={{ width: 10, height: 10, background: BLUE, borderRadius: 2, boxShadow: `0 0 6px ${BLUE}aa` }} />
            Blue Side
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: RED }}>
            <span style={{ width: 10, height: 10, background: RED, borderRadius: 2, boxShadow: `0 0 6px ${RED}aa` }} />
            Red Side
          </span>
        </div>
      </div>

      <div className="card" style={{
        padding: 12, position: "relative",
        background: "linear-gradient(180deg, rgba(59,130,246,0.04) 0%, rgba(2,6,23,0) 50%, rgba(239,68,68,0.04) 100%)",
        border: "1px solid var(--border)",
      }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          height={H}
          preserveAspectRatio="none"
          style={{ display: "block", overflow: "visible" }}
          onMouseMove={onMove}
          onMouseLeave={() => setHoverIdx(null)}
          role="img"
          aria-label={`Gold diff sur ${xMax} minutes`}
        >
          <defs>
            <linearGradient id="goldGradBlue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor={BLUE} stopOpacity="0.55" />
              <stop offset="100%" stopColor={BLUE} stopOpacity="0" />
            </linearGradient>
            <linearGradient id="goldGradRed" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%"  stopColor={RED} stopOpacity="0.55" />
              <stop offset="100%" stopColor={RED} stopOpacity="0" />
            </linearGradient>
            <clipPath id="clipBlue">
              <rect x={PAD_L} y={PAD_T} width={PLOT_W} height={PLOT_H / 2} />
            </clipPath>
            <clipPath id="clipRed">
              <rect x={PAD_L} y={MID_Y} width={PLOT_W} height={PLOT_H / 2} />
            </clipPath>
          </defs>

          {/* Grid + Y ticks */}
          {yTicks.map((t, i) => (
            <g key={i}>
              <line
                x1={PAD_L} x2={W - PAD_R}
                y1={t.y} y2={t.y}
                stroke={t.v === 0 ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.05)"}
                strokeWidth={t.v === 0 ? 1.2 : 1}
                strokeDasharray={t.v === 0 ? "none" : "3 4"}
              />
              <text
                x={PAD_L - 8} y={t.y}
                textAnchor="end"
                dominantBaseline="middle"
                fill="var(--text-2)"
                fontSize="10"
                fontFamily="'Chakra Petch', monospace"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {t.label}
              </text>
            </g>
          ))}

          {/* X ticks */}
          {xTicks.map((m, i) => (
            <g key={`x${i}`}>
              <line
                x1={xOf(m)} x2={xOf(m)}
                y1={PAD_T} y2={H - PAD_B}
                stroke="rgba(255,255,255,0.04)"
                strokeWidth="1"
              />
              <text
                x={xOf(m)} y={H - PAD_B + 16}
                textAnchor="middle"
                fill="var(--text-2)"
                fontSize="10"
                fontFamily="'Chakra Petch', monospace"
              >
                {m}′
              </text>
            </g>
          ))}

          {/* Aires bleue (au-dessus) et rouge (en dessous), clippées */}
          <path d={pathD} fill="url(#goldGradBlue)" clipPath="url(#clipBlue)" />
          <path d={pathD} fill="url(#goldGradRed)"  clipPath="url(#clipRed)" />

          {/* Ligne principale animée */}
          <path
            d={lineD}
            fill="none"
            stroke="rgba(255,255,255,0.85)"
            strokeWidth="1.6"
            strokeLinejoin="round"
            strokeLinecap="round"
            style={reduceMotion ? {} : {
              strokeDasharray: 2000,
              strokeDashoffset: 2000,
              animation: "goldLineDraw 900ms ease-out forwards",
            }}
          />

          {/* Hover : ligne verticale + point + tooltip */}
          {hoverPoint && (
            <g style={{ pointerEvents: "none" }}>
              <line
                x1={xOf(hoverPoint.minute)} x2={xOf(hoverPoint.minute)}
                y1={PAD_T} y2={H - PAD_B}
                stroke="rgba(255,255,255,0.3)"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
              <circle
                cx={xOf(hoverPoint.minute)}
                cy={yOf(hoverPoint.diff)}
                r="4"
                fill={hoverPoint.diff >= 0 ? BLUE : RED}
                stroke="white"
                strokeWidth="1.5"
              />
            </g>
          )}
        </svg>

        {/* Tooltip HTML (positionné au-dessus du SVG) */}
        {hoverPoint && (
          <div style={{
            position: "absolute",
            top: 8,
            left: `calc(${(xOf(hoverPoint.minute) / W) * 100}% + 0px)`,
            transform: "translateX(-50%)",
            padding: "5px 9px",
            background: "rgba(2,6,23,0.96)",
            border: `1px solid ${hoverPoint.diff >= 0 ? BLUE : RED}66`,
            borderRadius: 4,
            boxShadow: "0 4px 14px rgba(0,0,0,0.6)",
            backdropFilter: "blur(6px)",
            pointerEvents: "none",
            whiteSpace: "nowrap",
            zIndex: 5,
          }}>
            <div style={{
              fontFamily: FONT_STATS, fontSize: 11, fontWeight: 800,
              color: hoverPoint.diff >= 0 ? BLUE : RED,
              fontVariantNumeric: "tabular-nums",
            }}>
              {hoverLeader === "—" ? "Égalité" : `${hoverLeader} +${(Math.abs(hoverPoint.diff) / 1000).toFixed(1)}k`}
            </div>
            <div style={{
              fontSize: 9, color: "var(--text-2)", letterSpacing: 0.5,
              textTransform: "uppercase", fontWeight: 700,
            }}>
              Min {hoverPoint.minute}
            </div>
          </div>
        )}

        <style>{`
          @keyframes goldLineDraw {
            to { stroke-dashoffset: 0; }
          }
        `}</style>
      </div>
    </section>
  );
}

export default function MatchResultScoreboard({ matchResult, userTeam, opponentTeam, isTeam1, teams, onClose }) {
  const reduceMotion = useReducedMotion();

  if (!matchResult?.match_details) return null;

  const team1Stats = matchResult.match_details.team1_stats || [];
  const team2Stats = matchResult.match_details.team2_stats || [];
  const userStats = isTeam1 ? team1Stats : team2Stats;
  const oppStats = isTeam1 ? team2Stats : team1Stats;
  const userWon = matchResult.winner === userTeam.id;
  const dur = matchResult.match_details.duration;

  const totalKills1 = team1Stats.reduce((a, p) => a + (p.kills || 0), 0);
  const totalKills2 = team2Stats.reduce((a, p) => a + (p.kills || 0), 0);
  const userScore = isTeam1 ? totalKills1 : totalKills2;
  const oppScore  = isTeam1 ? totalKills2 : totalKills1;

  // Gold total équipe : utiliser la dernière entrée du gold_timeline (cohérent avec gold_diff)
  const goldTimeline = matchResult.match_details.gold_timeline || [];
  const lastGold = goldTimeline.length > 0 ? goldTimeline[goldTimeline.length - 1] : { g1: 0, g2: 0 };
  const team1Gold = lastGold.g1 || 0;
  const team2Gold = lastGold.g2 || 0;
  const userTotalGold = isTeam1 ? team1Gold : team2Gold;
  const oppTotalGold  = isTeam1 ? team2Gold : team1Gold;

  const mvp = getMVP(matchResult, userTeam.id);
  const mvpKDA = mvp ? ((mvp.kills + mvp.assists) / Math.max(1, mvp.deaths)).toFixed(2) : "0";
  const mvpDur = Math.max(dur || 1, 1);
  const mvpNote = mvp ? calcNote(mvp, dur, userWon) : 0;

  const heroAccent = userWon ? ACCENT_WIN : ACCENT_LOSS;
  const heroLabel  = userWon ? "VICTOIRE" : "DÉFAITE";

  const fadeIn = reduceMotion
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };

  return (
    <div>
      {/* ─── HERO : Victory/Defeat + Score intégré ─────────────── */}
      <motion.section
        {...(reduceMotion ? {} : { initial: { opacity: 0, scale: 0.96 }, animate: { opacity: 1, scale: 1 }, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] } })}
        aria-label={`Résultat du match : ${heroLabel}`}
        style={{
          position: "relative", overflow: "hidden",
          padding: "28px 24px", marginBottom: 20,
          background: userWon
            ? "radial-gradient(ellipse at 50% 0%, rgba(34,197,94,0.22), transparent 70%), linear-gradient(180deg, rgba(34,197,94,0.08), rgba(2,6,23,0.6))"
            : "radial-gradient(ellipse at 50% 0%, rgba(239,68,68,0.18), transparent 70%), linear-gradient(180deg, rgba(239,68,68,0.06), rgba(2,6,23,0.6))",
          border: `1px solid ${heroAccent}55`,
          borderRadius: 6,
          boxShadow: `0 0 0 1px rgba(0,0,0,0.4), inset 0 1px 0 ${heroAccent}33`,
        }}
      >
        {/* Scanline subtile */}
        <div aria-hidden="true" style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.015) 2px, rgba(255,255,255,0.015) 3px)",
          opacity: 0.6,
        }} />

        {/* Header label */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
          marginBottom: 8,
        }}>
          <Trophy
            size={28} weight="fill"
            style={{ color: userWon ? ACCENT_MVP : "var(--text-2)" }}
          />
          <h2 style={{
            margin: 0,
            fontFamily: FONT_HEADING, fontSize: 44, fontWeight: 400,
            color: heroAccent, letterSpacing: 6,
            textShadow: userWon ? `0 0 24px ${heroAccent}99, 0 0 4px ${heroAccent}` : "none",
          }}>
            {heroLabel}
          </h2>
        </div>

        {/* Score line */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 28,
          marginTop: 14,
        }}>
          <div style={{ textAlign: "center", minWidth: 80 }}>
            <TeamLogo teamId={userTeam.id} abbr={userTeam.abbr} size={48} />
            <div style={{
              marginTop: 4, fontFamily: FONT_HEADING, fontSize: 13, letterSpacing: 1,
              color: userWon ? heroAccent : "var(--text-1)",
            }}>{userTeam.abbr}</div>
            <div style={{ fontSize: 10, color: "var(--text-2)" }}>{userTeam.name}</div>
          </div>

          <div style={{
            display: "flex", alignItems: "center", gap: 14,
            fontFamily: FONT_STATS, fontWeight: 900,
            fontVariantNumeric: "tabular-nums",
          }}>
            <span style={{
              fontSize: 56, lineHeight: 1,
              color: userWon ? ACCENT_WIN : "var(--text-1)",
              textShadow: userWon ? `0 0 18px ${ACCENT_WIN}88` : "none",
            }}>{userScore}</span>
            <span style={{ fontSize: 26, color: "var(--text-2)" }}>:</span>
            <span style={{
              fontSize: 56, lineHeight: 1,
              color: !userWon ? ACCENT_LOSS : "var(--text-1)",
              textShadow: !userWon ? `0 0 18px ${ACCENT_LOSS}66` : "none",
            }}>{oppScore}</span>
          </div>

          <div style={{ textAlign: "center", minWidth: 80 }}>
            <TeamLogo teamId={opponentTeam?.id} abbr={opponentTeam?.abbr || ""} size={48} />
            <div style={{
              marginTop: 4, fontFamily: FONT_HEADING, fontSize: 13, letterSpacing: 1,
              color: !userWon ? ACCENT_LOSS : "var(--text-1)",
            }}>{opponentTeam?.abbr}</div>
            <div style={{ fontSize: 10, color: "var(--text-2)" }}>{opponentTeam?.name}</div>
          </div>
        </div>

        {/* Mini stats équipe utilisateur */}
        <div style={{
          marginTop: 20, paddingTop: 16,
          borderTop: `1px solid ${heroAccent}33`,
          display: "flex", justifyContent: "center", gap: 32, flexWrap: "wrap",
        }}>
          <MiniStat icon={Timer} label="Durée"      value={`${dur}m`} />
          <MiniStat icon={Coins} label="Gold total" value={`${(userTotalGold / 1000).toFixed(1)}k`} color={ACCENT_MVP} />
        </div>
      </motion.section>

      {/* ─── MVP ───────────────────────────────────────────────── */}
      {mvp && (
        <motion.section
          {...fadeIn}
          transition={{ delay: reduceMotion ? 0 : 0.15 }}
          aria-label={`MVP du match : ${mvp.player_name || mvp.position}`}
          style={{
            position: "relative", overflow: "hidden",
            marginBottom: 20, padding: 16,
            background: "linear-gradient(135deg, rgba(255,184,0,0.12), rgba(255,184,0,0.03) 60%, transparent)",
            border: `1px solid ${ACCENT_MVP}66`,
            borderRadius: 4,
            boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.04), 0 0 24px rgba(255,184,0,0.12)`,
            display: "flex", alignItems: "center", gap: 16,
          }}
        >
          {/* Portrait */}
          <div style={{
            position: "relative", width: 64, height: 64, flexShrink: 0,
          }}>
            {mvp.champion ? (
              <img
                src={`https://ddragon.leagueoflegends.com/cdn/${_ddVersion}/img/champion/${toDDragonKey(mvp.champion)}.png`}
                alt={`Champion ${mvp.champion}`}
                style={{
                  width: "100%", height: "100%", borderRadius: 4,
                  border: `2px solid ${ACCENT_MVP}`,
                  boxShadow: `0 0 16px ${ACCENT_MVP}66`,
                }}
                onError={e => { e.currentTarget.style.display = "none"; }}
              />
            ) : (
              <div style={{
                width: "100%", height: "100%", borderRadius: 4,
                background: ACCENT_MVP,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Star size={28} weight="fill" style={{ color: "black" }} />
              </div>
            )}
            <span style={{
              position: "absolute", top: -6, left: -6,
              padding: "2px 6px", borderRadius: 3,
              background: ACCENT_MVP, color: "#1a1300",
              fontFamily: FONT_HEADING, fontSize: 9, fontWeight: 800,
              letterSpacing: 1, textTransform: "uppercase",
              display: "inline-flex", alignItems: "center", gap: 3,
              boxShadow: `0 0 10px ${ACCENT_MVP}aa`,
            }}>
              <Star size={9} weight="fill" /> MVP
            </span>
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: FONT_HEADING, fontSize: 18, lineHeight: 1.1,
              color: "var(--text-1)",
            }}>
              {mvp.player_name || mvp.position}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 2 }}>
              {mvp.position}{mvp.champion ? ` · ${mvp.champion}` : ""}
            </div>
          </div>

          {/* Stats MVP en quadrille */}
          <div style={{ display: "flex", gap: 18 }}>
            <MiniStat
              icon={Crosshair} label="K/D/A"
              value={`${mvp.kills}/${mvp.deaths}/${mvp.assists}`}
              color={ACCENT_WIN}
            />
            <MiniStat icon={Star} label="Note" value={mvpNote.toFixed(1)} color={ACCENT_MVP} />
            <MiniStat icon={Sword} label="DMG" value={mvp.damage ? `${(mvp.damage/1000).toFixed(1)}k` : "—"} color={ACCENT_MVP} />
            <MiniStat icon={Coins} label="CS/m" value={((mvp.cs || 0) / mvpDur).toFixed(1)} />
            <MiniStat icon={Trophy} label="KDA" value={mvpKDA} />
          </div>
        </motion.section>
      )}

      {/* ─── Stats par équipe ──────────────────────────────────── */}
      <div className="grid-2" style={{ gap: 16, marginBottom: 20 }}>
        <TeamStatsCard
          stats={userStats}
          won={userWon}
          teamId={userTeam.id}
          teamAbbr={userTeam.abbr}
          teamName={userTeam.name}
          duration={dur}
          totalGold={userTotalGold}
        />
        <TeamStatsCard
          stats={oppStats}
          won={!userWon}
          teamId={opponentTeam?.id}
          teamAbbr={opponentTeam?.abbr || ""}
          teamName={opponentTeam?.name}
          duration={dur}
          totalGold={oppTotalGold}
        />
      </div>

      {/* ─── Gold Timeline Graph ───────────────────────────────── */}
      {goldTimeline.length > 1 && (
        <GoldDiffChart goldTimeline={goldTimeline} duration={dur} />
      )}

      {/* ─── Autres résultats ──────────────────────────────────── */}
      {matchResult?.other_results?.length > 0 && (
        <section style={{ marginBottom: 16 }} aria-label="Autres résultats de la semaine">
          <h3 style={{
            fontFamily: FONT_HEADING, fontSize: 12, letterSpacing: 2,
            color: "var(--text-2)", textTransform: "uppercase",
            margin: "0 0 10px 0",
          }}>
            Autres résultats de la semaine
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {matchResult.other_results.map((om) => {
              const t1 = teams.find(t => t.id === om.team1);
              const t2 = teams.find(t => t.id === om.team2);
              const w1 = om.winner === om.team1;
              return (
                <div key={om.id} style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 110px 1fr",
                  alignItems: "center",
                  padding: "8px 12px",
                  background: "var(--bg-card)",
                  borderRadius: 4,
                  border: "1px solid var(--border)",
                  fontSize: 12,
                }}>
                  {/* Team 1 */}
                  <div style={{
                    display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end",
                    fontWeight: w1 ? 700 : 500,
                    color: w1 ? "var(--text-1)" : "var(--text-2)",
                    opacity: w1 ? 1 : 0.7,
                  }}>
                    <span style={{
                      fontFamily: FONT_HEADING, fontSize: 11, letterSpacing: 0.8,
                    }}>{t1?.abbr || om.team1}</span>
                    <TeamLogo teamId={t1?.id || om.team1} abbr={t1?.abbr || om.team1} size={22} />
                  </div>

                  {/* Score */}
                  <div style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                    fontFamily: FONT_STATS, fontWeight: 800, fontSize: 16,
                    fontVariantNumeric: "tabular-nums",
                  }}>
                    <span style={{ color: w1 ? ACCENT_WIN : "var(--text-2)" }}>{om.score1}</span>
                    <span style={{ color: "var(--text-2)", fontSize: 11 }}>—</span>
                    <span style={{ color: !w1 ? ACCENT_WIN : "var(--text-2)" }}>{om.score2}</span>
                  </div>

                  {/* Team 2 */}
                  <div style={{
                    display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-start",
                    fontWeight: !w1 ? 700 : 500,
                    color: !w1 ? "var(--text-1)" : "var(--text-2)",
                    opacity: !w1 ? 1 : 0.7,
                  }}>
                    <TeamLogo teamId={t2?.id || om.team2} abbr={t2?.abbr || om.team2} size={22} />
                    <span style={{
                      fontFamily: FONT_HEADING, fontSize: 11, letterSpacing: 0.8,
                    }}>{t2?.abbr || om.team2}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ─── CTA Retour ────────────────────────────────────────── */}
      <button
        type="button"
        className="btn-primary"
        onClick={onClose}
        data-testid="close-match-btn"
        aria-label="Retour au tableau de bord"
        style={{
          width: "100%", padding: "14px 20px", marginTop: 8,
          display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
          fontFamily: FONT_HEADING, fontSize: 14, letterSpacing: 2,
          textTransform: "uppercase",
          minHeight: 48,
          cursor: "pointer",
          transition: "transform 160ms ease, box-shadow 160ms ease",
        }}
        onMouseEnter={e => {
          if (!reduceMotion) e.currentTarget.style.transform = "translateY(-1px)";
          e.currentTarget.style.boxShadow = "0 0 0 1px rgba(34,197,94,0.4), 0 6px 20px rgba(34,197,94,0.25)";
        }}
        onMouseLeave={e => {
          e.currentTarget.style.transform = "translateY(0)";
          e.currentTarget.style.boxShadow = "";
        }}
      >
        <ArrowLeft size={16} weight="bold" />
        Retour au Dashboard
      </button>
    </div>
  );
}

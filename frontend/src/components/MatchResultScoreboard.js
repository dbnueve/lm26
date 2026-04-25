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

/* ─── StatChip avec tooltip custom au survol ─────────────────── */
function StatChip({ value, label, valueColor = "var(--text-1)", tooltip }) {
  const [hover, setHover] = React.useState(false);
  const [focus, setFocus] = React.useState(false);
  const open = (hover || focus) && tooltip;

  return (
    <div
      tabIndex={tooltip ? 0 : -1}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={{
        position: "relative", display: "flex", flexDirection: "column",
        alignItems: "flex-end", lineHeight: 1.05,
        cursor: tooltip ? "help" : "default",
        outline: "none",
        borderRadius: 3,
        boxShadow: focus ? "0 0 0 2px rgba(34,197,94,0.5)" : "none",
        transition: "box-shadow 160ms ease",
      }}
    >
      <span style={{
        fontFamily: FONT_STATS, fontSize: 14, fontWeight: 800,
        color: valueColor, fontVariantNumeric: "tabular-nums",
      }}>{value}</span>
      <span style={{
        fontSize: 8, color: "var(--text-2)", letterSpacing: 0.8,
        fontWeight: 700, textTransform: "uppercase",
      }}>{label}</span>

      {open && (
        <div
          role="tooltip"
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            right: 0,
            zIndex: 50,
            padding: "6px 10px",
            background: "rgba(2,6,23,0.96)",
            border: "1px solid rgba(34,197,94,0.4)",
            borderRadius: 4,
            boxShadow: "0 8px 24px rgba(0,0,0,0.6), 0 0 12px rgba(34,197,94,0.18)",
            backdropFilter: "blur(8px)",
            whiteSpace: "nowrap",
            pointerEvents: "none",
            animation: "tooltipFadeIn 140ms ease-out",
          }}
        >
          <span style={{
            fontFamily: FONT_STATS, fontSize: 11, fontWeight: 600,
            color: "var(--text-1)", letterSpacing: 0.4,
            fontVariantNumeric: "tabular-nums",
          }}>
            {tooltip}
          </span>
          {/* Petite flèche */}
          <span aria-hidden="true" style={{
            position: "absolute", top: "100%", right: 12,
            width: 0, height: 0,
            borderLeft: "5px solid transparent",
            borderRight: "5px solid transparent",
            borderTop: "5px solid rgba(34,197,94,0.4)",
          }} />
        </div>
      )}
    </div>
  );
}

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

function TeamStatsCard({ stats, won, teamId, teamAbbr, teamName, duration }) {
  const accent = won ? ACCENT_WIN : ACCENT_LOSS;
  const maxDamage = useMemo(
    () => Math.max(0, ...stats.map(p => p.damage || 0)),
    [stats]
  );
  const totalKills   = stats.reduce((a, p) => a + (p.kills || 0), 0);
  const totalDeaths  = stats.reduce((a, p) => a + (p.deaths || 0), 0);
  const totalAssists = stats.reduce((a, p) => a + (p.assists || 0), 0);
  const totalGold    = stats.reduce((a, p) => a + (p.gold || 0), 0);
  const teamKDA = ((totalKills + totalAssists) / Math.max(1, totalDeaths)).toFixed(2);

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
          <StatChip
            value={`${(totalGold / 1000).toFixed(1)}k`}
            label="Gold"
            valueColor={ACCENT_MVP}
            tooltip={`${totalGold.toLocaleString("fr-FR")} g · Gold total équipe`}
          />
          <StatChip
            value={teamKDA}
            label="KDA"
            valueColor={accent}
            tooltip={`${totalKills} / ${totalDeaths} / ${totalAssists}  ·  K/D/A équipe`}
          />
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

  // Stats globales user team pour le hero
  const userTotalGold = userStats.reduce((a, p) => a + (p.gold || 0), 0);

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
        />
        <TeamStatsCard
          stats={oppStats}
          won={!userWon}
          teamId={opponentTeam?.id}
          teamAbbr={opponentTeam?.abbr || ""}
          teamName={opponentTeam?.name}
          duration={dur}
        />
      </div>

      {/* ─── Phases ────────────────────────────────────────────── */}
      {(matchResult.match_details.phases || []).length > 0 && (
        <section style={{ marginBottom: 20 }} aria-label="Phases du match">
          <h3 style={{
            fontFamily: FONT_HEADING, fontSize: 12, letterSpacing: 2,
            color: "var(--text-2)", textTransform: "uppercase",
            margin: "0 0 10px 0",
          }}>
            Phases du match
          </h3>
          <div className="grid-3" style={{ gap: 10 }}>
            {(matchResult.match_details.phases || []).map((p, i) => {
              const phaseColor = i === 0 ? "#4FC3F7" : i === 1 ? "#FFB800" : "#FF5252";
              const userAdvantage = p.advantage === (isTeam1 ? 1 : 2);
              return (
                <div key={i} className="card" style={{
                  padding: 14, position: "relative", overflow: "hidden",
                  borderLeft: `3px solid ${phaseColor}`,
                  background: `linear-gradient(180deg, ${phaseColor}10, transparent 60%)`,
                }}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
                    <h5 style={{
                      margin: 0, fontFamily: FONT_HEADING, fontSize: 14,
                      color: phaseColor, letterSpacing: 1,
                    }}>{p.name}</h5>
                    <span style={{ fontSize: 11, color: "var(--text-2)", fontFamily: FONT_STATS }}>
                      {p.duration}
                    </span>
                  </div>
                  <div style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    fontSize: 11, color: "var(--text-2)", marginBottom: 4,
                    textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600,
                  }}>
                    <span>Avantage Gold</span>
                    <span style={{
                      fontFamily: FONT_STATS, fontSize: 14, fontWeight: 800,
                      color: userAdvantage ? ACCENT_WIN : ACCENT_LOSS,
                      fontVariantNumeric: "tabular-nums",
                    }}>
                      {userAdvantage ? "+" : "−"}{Math.abs(p.gold_diff)}
                    </span>
                  </div>
                  {/* Barre direction avantage */}
                  <div style={{
                    height: 4, borderRadius: 2, overflow: "hidden",
                    background: "rgba(255,255,255,0.06)",
                    display: "flex",
                  }}>
                    <div style={{
                      width: userAdvantage ? "100%" : "0%",
                      height: "100%",
                      background: `linear-gradient(90deg, ${ACCENT_WIN}, transparent)`,
                      transition: "width 360ms ease-out",
                    }} />
                    <div style={{
                      width: !userAdvantage ? "100%" : "0%",
                      height: "100%",
                      background: `linear-gradient(270deg, ${ACCENT_LOSS}, transparent)`,
                      transition: "width 360ms ease-out",
                    }} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
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

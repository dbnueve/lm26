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

function TeamStatsCard({ stats, title, won, headerBg, headerColor, teamId, teamAbbr, duration }) {
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{
        padding: "12px 16px", background: headerBg, color: headerColor,
        fontWeight: 700, display: "flex", alignItems: "center", gap: 8,
      }}>
        <Shield size={18} weight="fill" />
        <TeamLogo teamId={teamId} abbr={teamAbbr} size={18} style={{ marginRight: 4 }} /> — {title}
      </div>
      <div style={{ padding: 8 }}>
        <div style={{
          display: "grid", gridTemplateColumns: "36px 1fr 80px 50px 65px 70px",
          padding: "8px 12px", fontSize: 11,
          color: "var(--text-2)", fontWeight: 600, textTransform: "uppercase",
        }}>
          <span /><span>Joueur</span>
          <span style={{ textAlign: "center" }}>K/D/A</span>
          <span style={{ textAlign: "center" }}>Note</span>
          <span style={{ textAlign: "center" }}>CS/M</span>
          <span style={{ textAlign: "right" }}>DMG</span>
        </div>
        {stats.map((p, i) => <StatRow key={i} p={p} duration={duration} won={won} />)}
      </div>
    </div>
  );
}

export default function MatchResultScoreboard({ matchResult, userTeam, opponentTeam, isTeam1, teams, onClose }) {
  if (!matchResult?.match_details) return null;

  const team1Stats = matchResult.match_details.team1_stats || [];
  const team2Stats = matchResult.match_details.team2_stats || [];
  const userStats = isTeam1 ? team1Stats : team2Stats;
  const oppStats = isTeam1 ? team2Stats : team1Stats;
  const userWon = matchResult.winner === userTeam.id;
  const dur = matchResult.match_details.duration;

  const totalKills1 = team1Stats.reduce((a, p) => a + (p.kills || 0), 0);
  const totalKills2 = team2Stats.reduce((a, p) => a + (p.kills || 0), 0);

  const mvp = getMVP(matchResult, userTeam.id);

  return (
    <div>
      {/* Victory/Defeat Banner */}
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        style={{
          textAlign: "center", padding: "32px 24px", marginBottom: 24,
          background: userWon
            ? "linear-gradient(135deg, rgba(255, 184, 0, 0.15) 0%, rgba(0, 230, 118, 0.1) 100%)"
            : "linear-gradient(135deg, rgba(255, 51, 102, 0.15) 0%, rgba(139, 0, 0, 0.1) 100%)",
          border: "2px solid " + (userWon ? "var(--amber)" : "var(--danger)"),
          borderRadius: 4,
        }}
      >
        <Trophy size={56} weight="fill" style={{
          color: userWon ? "var(--amber)" : "var(--text-2)", marginBottom: 12,
        }} />
        <h2 className="font-heading" style={{
          fontSize: 42,
          color: userWon ? "var(--amber)" : "var(--danger)",
          textShadow: userWon ? "0 0 30px rgba(255, 184, 0, 0.5)" : "none",
        }}>
          {userWon ? "VICTOIRE" : "DÉFAITE"}
        </h2>
        <div style={{ color: "var(--text-2)", marginTop: 8, fontSize: 16 }}>
          Durée: {dur} minutes
        </div>
      </motion.div>

      {/* Match Score */}
      <div style={{
        display: "flex", justifyContent: "center", alignItems: "center",
        gap: 32, marginBottom: 32, padding: 24,
        background: "var(--surface-1)", borderRadius: 4,
      }}>
        <div style={{ textAlign: "center" }}>
          <TeamLogo teamId={userTeam.id} abbr={userTeam.abbr} size={48} />
          <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 4 }}>{userTeam.name}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span className="font-stats" style={{
            fontSize: 48, fontWeight: 900,
            color: userWon ? "var(--success)" : "var(--danger)",
          }}>
            {isTeam1 ? totalKills1 : totalKills2}
          </span>
          <span style={{ fontSize: 24, color: "var(--text-2)" }}>-</span>
          <span className="font-stats" style={{
            fontSize: 48, fontWeight: 900,
            color: !userWon ? "var(--success)" : "var(--danger)",
          }}>
            {isTeam1 ? totalKills2 : totalKills1}
          </span>
        </div>
        <div style={{ textAlign: "center" }}>
          <TeamLogo teamId={opponentTeam?.id} abbr={opponentTeam?.abbr || ""} size={48} />
          <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 4 }}>{opponentTeam?.name}</div>
        </div>
      </div>

      {/* MVP */}
      {mvp && (
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2 }}
          style={{
            marginBottom: 24, padding: 20,
            background: "linear-gradient(135deg, rgba(255, 184, 0, 0.1) 0%, rgba(255, 184, 0, 0.05) 100%)",
            border: "2px solid var(--amber)",
            borderRadius: 4, display: "flex", alignItems: "center", gap: 20,
          }}
        >
          <div style={{
            width: 60, height: 60, background: "var(--amber)",
            borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Star size={32} weight="fill" style={{ color: "black" }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: "var(--amber)", fontWeight: 700, letterSpacing: 2 }}>
              MVP DU MATCH
            </div>
            <div className="font-heading" style={{ fontSize: 24, display: "flex", alignItems: "center", gap: 10 }}>
              {mvp.champion && (
                <img
                  src={`https://ddragon.leagueoflegends.com/cdn/${_ddVersion}/img/champion/${toDDragonKey(mvp.champion)}.png`}
                  alt={mvp.champion}
                  style={{ width: 36, height: 36, borderRadius: 4, border: "2px solid var(--amber)" }}
                  onError={e => { e.currentTarget.style.display = "none"; }}
                />
              )}
              {mvp.player_name || mvp.position}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-2)" }}>
              {mvp.position}{mvp.champion ? ` · ${mvp.champion}` : ""}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="font-stats" style={{ fontSize: 28, fontWeight: 900, color: "var(--success)" }}>
              {mvp.kills}/{mvp.deaths}/{mvp.assists}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-2)" }}>
              KDA: {((mvp.kills + mvp.assists) / Math.max(1, mvp.deaths)).toFixed(2)}
            </div>
          </div>
        </motion.div>
      )}

      {/* Stats par équipe */}
      <div className="grid-2" style={{ gap: 24, marginBottom: 24 }}>
        <TeamStatsCard
          stats={userStats}
          title={userWon ? "Victoire" : "Défaite"}
          won={userWon}
          headerBg="var(--accent)"
          headerColor="black"
          teamId={userTeam.id}
          teamAbbr={userTeam.abbr}
          duration={dur}
        />
        <TeamStatsCard
          stats={oppStats}
          title={!userWon ? "Victoire" : "Défaite"}
          won={!userWon}
          headerBg="var(--danger)"
          headerColor="white"
          teamId={opponentTeam?.id}
          teamAbbr={opponentTeam?.abbr || ""}
          duration={dur}
        />
      </div>

      {/* Phases */}
      <div className="grid-3" style={{ marginBottom: 24 }}>
        {(matchResult.match_details.phases || []).map((p, i) => (
          <div key={i} className="card" style={{
            padding: 16,
            borderLeft: "3px solid " + (i === 0 ? "#4FC3F7" : i === 1 ? "#FFB800" : "#FF5252"),
          }}>
            <h5 className="font-heading" style={{ marginBottom: 8 }}>{p.name}</h5>
            <div style={{ fontSize: 13, color: "var(--text-2)" }}>{p.duration}</div>
            <div style={{ marginTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Avantage Gold</span>
                <span className="font-stats" style={{
                  color: p.advantage === (isTeam1 ? 1 : 2) ? "var(--success)" : "var(--danger)",
                }}>
                  {p.advantage === (isTeam1 ? 1 : 2) ? "+" : "-"}{p.gold_diff}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Autres résultats */}
      {matchResult?.other_results?.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h4 className="font-heading" style={{
            marginBottom: 12, color: "var(--text-2)",
            fontSize: 13, textTransform: "uppercase", letterSpacing: 1,
          }}>
            Autres résultats de la semaine
          </h4>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {matchResult.other_results.map((om) => {
              const t1 = teams.find(t => t.id === om.team1);
              const t2 = teams.find(t => t.id === om.team2);
              return (
                <div key={om.id} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "8px 12px", background: "var(--bg-card)", borderRadius: 4, fontSize: 13,
                }}>
                  <span style={{
                    fontWeight: om.winner === om.team1 ? 700 : 400,
                    color: om.winner === om.team1 ? "var(--text-1)" : "var(--text-2)",
                    minWidth: 80,
                  }}>
                    <TeamLogo teamId={t1?.id || om.team1} abbr={t1?.abbr || om.team1} size={20} />
                  </span>
                  <span className="font-stats" style={{ color: "var(--text-2)", margin: "0 8px" }}>
                    {om.score1} - {om.score2}
                  </span>
                  <span style={{
                    fontWeight: om.winner === om.team2 ? 700 : 400,
                    color: om.winner === om.team2 ? "var(--text-1)" : "var(--text-2)",
                    minWidth: 80, textAlign: "right",
                  }}>
                    <TeamLogo teamId={t2?.id || om.team2} abbr={t2?.abbr || om.team2} size={20} />
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <button
        className="btn-primary"
        style={{ width: "100%", padding: 16, fontSize: 16, marginTop: 16 }}
        onClick={onClose}
        data-testid="close-match-btn"
      >
        Retour au Dashboard
      </button>
    </div>
  );
}

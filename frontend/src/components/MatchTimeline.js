import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { _ddVersion, toDDragonKey } from "./ddHelpers";

// ── Constants ────────────────────────────────────────────────────────────────

// Chaque tick = 100ms réels ; "step" = secondes de match avancées par tick
const SPEEDS = [
  { label: "1×",  step: 3  },   // ~60s réels pour un match de 30 min
  { label: "2×",  step: 7  },   // ~26s
  { label: "4×",  step: 15 },   // ~12s
];

const TICK_MS = 100;

const KILL_TYPES = new Set(["kill","first_blood","double_kill","triple_kill","quadra_kill","penta_kill"]);

const EVENT_ICON = {
  first_blood : "🩸",
  kill        : "💀",
  double_kill : "💥",
  triple_kill : "🔥",
  quadra_kill : "⚡",
  penta_kill  : "👑",
  teamfight   : "⚔️",
  tower       : "🏯",
  first_tower : "🏯",
  drake       : "🐉",
  herald      : "🔮",
  baron       : "👑",
  elder       : "🟣",
  inhibitor   : "💎",
  game_end    : "💥",
  objective   : "🎯",
};

const CS_EXPECT = { TOP: 9.0, JUNGLE: 7.5, MID: 9.0, ADC: 9.5, SUPPORT: 0.8 };

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseSec(t) {
  if (!t) return 99 * 60;
  const parts = String(t).split(":");
  return parseInt(parts[0], 10) * 60 + (parseInt(parts[1], 10) || 0);
}

function parseMin(t) {
  if (!t) return 99;
  return parseInt(String(t).split(":")[0], 10);
}

function fmtTime(totalSec) {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function calcNote(p, duration, won) {
  const pos      = p.position || "MID";
  const k        = p.kills    || 0;
  const d        = Math.max(p.deaths || 1, 1);
  const a        = p.assists  || 0;
  const cs       = p.cs       || 0;
  const dur      = Math.max(duration || 1, 1);
  const kdaScore = Math.min(5.0, ((k + a * 0.5) / d) * 1.2);
  const csScore  = Math.min(3.0, (cs / dur / Math.max(CS_EXPECT[pos] || 8.0, 0.1)) * 3.0);
  return Math.round((kdaScore + csScore + (won ? 2.0 : 0.0)) * 10) / 10;
}

// ── EventRow ─────────────────────────────────────────────────────────────────

const EventRow = React.memo(function EventRow({ item, tc, tn }) {
  const icon = EVENT_ICON[item.type] || "📌";
  const isBig = ["baron","elder","penta_kill","quadra_kill","game_end"].includes(item.type);
  const isMulti = ["double_kill","triple_kill","quadra_kill","penta_kill"].includes(item.type);
  const isKill = KILL_TYPES.has(item.type);

  // Description enrichie : si le backend a envoyé killer/victim, on override
  let desc = (item.description || "")
    .replace(/l'équipe 1/gi, tn(1))
    .replace(/l'équipe 2/gi, tn(2));

  const teamColor = item.team ? tc(item.team) : "rgba(255,255,255,0.15)";

  if (item.type === "game_end") {
    return (
      <motion.div
        key={`end-${item.time}`}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.35 }}
        style={{
          textAlign: "center", padding: "16px 12px", marginTop: 6,
          background: "rgba(255,184,0,0.08)",
          border: "2px solid var(--secondary)",
          borderRadius: 8,
        }}
      >
        <div style={{ fontSize: 28 }}>💥</div>
        <div style={{ fontWeight: 800, fontSize: 16, marginTop: 4, color: "var(--secondary)" }}>
          {desc}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>
          {item.time}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.18 }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: isBig ? "10px 12px" : "6px 10px",
        borderRadius: 5,
        background: isMulti
          ? `${teamColor}22`
          : isBig
          ? `${teamColor}18`
          : "var(--surface)",
        borderLeft: `3px solid ${teamColor}`,
        borderTop: isBig ? `1px solid ${teamColor}55` : "none",
        borderRight: isBig ? `1px solid ${teamColor}25` : "none",
        borderBottom: isBig ? `1px solid ${teamColor}25` : "none",
      }}
    >
      <span style={{ fontSize: isBig ? 18 : 14, flexShrink: 0 }}>{icon}</span>

      <span style={{
        fontFamily: "monospace", fontSize: 10,
        color: "var(--text-secondary)",
        minWidth: 34, flexShrink: 0,
      }}>
        {item.time}
      </span>

      {/* Champion icon if available */}
      {isKill && item.killer_champion && (
        <img
          src={`https://ddragon.leagueoflegends.com/cdn/${_ddVersion}/img/champion/${toDDragonKey(item.killer_champion)}.png`}
          alt={item.killer_champion}
          title={item.killer_champion}
          style={{ width: 22, height: 22, borderRadius: 3, flexShrink: 0 }}
          onError={e => { e.currentTarget.style.display = "none"; }}
        />
      )}

      <span style={{
        flex: 1,
        fontSize: isMulti ? 13 : 12,
        fontWeight: isMulti ? 700 : 400,
        color: isMulti ? teamColor : "var(--text-primary)",
        lineHeight: 1.3,
      }}>
        {desc}
      </span>

      {item.team && !isMulti && (
        <span style={{
          fontWeight: 700, fontSize: 10, color: teamColor, flexShrink: 0,
        }}>
          {tn(item.team)}
        </span>
      )}
    </motion.div>
  );
});

// ── KillCounter ───────────────────────────────────────────────────────────────

function KillCounter({ value, color }) {
  const [displayed, setDisplayed] = useState(0);
  const prevRef = useRef(0);
  const timerRef = useRef(null);

  useEffect(() => {
    if (value === prevRef.current) return;
    const diff = value - prevRef.current;
    if (diff <= 0) { prevRef.current = value; setDisplayed(value); return; }
    if (timerRef.current) clearInterval(timerRef.current);
    const ms = Math.max(40, Math.min(120, 600 / diff));
    let cur = prevRef.current;
    timerRef.current = setInterval(() => {
      cur += 1;
      setDisplayed(cur);
      if (cur >= value) {
        clearInterval(timerRef.current);
        timerRef.current = null;
        prevRef.current = value;
      }
    }, ms);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [value]);

  return (
    <span style={{ fontSize: 48, fontWeight: 900, lineHeight: 1, color, fontVariantNumeric: "tabular-nums" }}>
      {displayed}
    </span>
  );
}

// ── MatchTimeline ─────────────────────────────────────────────────────────────

/**
 * Props
 *   phases, events, goldTimeline     : données du match
 *   team1Abbr / team2Abbr            : abréviations backend team1 / team2
 *   team1Stats / team2Stats          : stats joueurs
 *   duration                         : durée en minutes
 *   winnerTeam                       : 1 ou 2 (numérotation backend)
 *   userIsTeam1                      : true si l'user est team1
 *   onContinue                       : callback fin de timeline
 */
const MatchTimeline = ({
  phases = [], events = [], goldTimeline = [],
  team1Abbr, team2Abbr,
  team1Stats = [], team2Stats = [],
  duration    = 30,
  winnerTeam  = 0,
  userIsTeam1 = true,
  onContinue,
}) => {
  // Côtés : user toujours à gauche
  const leftNum  = userIsTeam1 ? 1 : 2;
  const rightNum = userIsTeam1 ? 2 : 1;
  const leftAbbr  = userIsTeam1 ? team1Abbr : team2Abbr;
  const rightAbbr = userIsTeam1 ? team2Abbr : team1Abbr;
  const leftStats  = userIsTeam1 ? team1Stats : team2Stats;
  const rightStats = userIsTeam1 ? team2Stats : team1Stats;
  const userWon   = winnerTeam === leftNum;

  const tc = useCallback((n) => n === 1 ? "var(--primary)" : "var(--danger)", []);
  const tn = useCallback((n) => n === 1 ? team1Abbr : team2Abbr, [team1Abbr, team2Abbr]);

  // Durée totale en secondes (à partir du game_end ou duration prop)
  const endSec = useMemo(() => {
    const endEv = events.find(e => e.type === "game_end");
    if (endEv) {
      const s = parseSec(endEv.time);
      if (s > 0) return s;
    }
    return Math.max(duration, 20) * 60;
  }, [events, duration]);

  // ── État du chrono ──────────────────────────────────────────────────────
  const [matchSec, setMatchSec]   = useState(0);
  const [playing,  setPlaying]    = useState(true);
  const [done,     setDone]       = useState(false);
  const [speedIdx, setSpeedIdx]   = useState(0);

  const intervalRef = useRef(null);
  const feedRef     = useRef(null);

  // Tick du chrono
  useEffect(() => {
    if (!playing || done) {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      return;
    }
    intervalRef.current = setInterval(() => {
      setMatchSec(s => {
        const next = s + SPEEDS[speedIdx].step;
        if (next >= endSec) {
          setDone(true);
          setPlaying(false);
          return endSec;
        }
        return next;
      });
    }, TICK_MS);
    return () => { if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; } };
  }, [playing, done, speedIdx, endSec]);

  // Skip
  const handleSkip = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    setMatchSec(endSec);
    setDone(true);
    setPlaying(false);
  }, [endSec]);

  // ── Dérivés ──────────────────────────────────────────────────────────────

  // Events visibles (tous ceux dont le timestamp ≤ matchSec courant)
  const sortedEvents = useMemo(() =>
    [...events].sort((a, b) => parseSec(a.time) - parseSec(b.time))
  , [events]);

  const visibleEvents = useMemo(() =>
    sortedEvents.filter(e => parseSec(e.time) <= matchSec)
  , [sortedEvents, matchSec]);

  // Kills = nb d'events kill-type visibles par équipe (chacun = 1 kill)
  const leftKills = useMemo(() =>
    visibleEvents.filter(e => KILL_TYPES.has(e.type) && e.team === leftNum).length
  , [visibleEvents, leftNum]);

  const rightKills = useMemo(() =>
    visibleEvents.filter(e => KILL_TYPES.has(e.type) && e.team === rightNum).length
  , [visibleEvents, rightNum]);

  // Phase courante
  const currentPhase = useMemo(() => {
    const PHASE_MIN = { "Early Game": [0, 14], "Mid Game": [14, 25], "Late Game": [25, 99] };
    const curMin = matchSec / 60;
    const found = phases.find(ph => {
      const [lo, hi] = PHASE_MIN[ph.name] || [0, 99];
      return curMin >= lo && curMin < hi;
    });
    return found || phases[phases.length - 1] || null;
  }, [phases, matchSec]);

  // Gold bar depuis goldTimeline
  const { leftWidth, goldDiff, goldLeader } = useMemo(() => {
    if (!goldTimeline || goldTimeline.length === 0) {
      return { leftWidth: 50, goldDiff: 0, goldLeader: null };
    }
    const curMin = Math.min(Math.floor(matchSec / 60), goldTimeline.length - 1);
    const entry  = goldTimeline[curMin] || goldTimeline[goldTimeline.length - 1];
    const g1 = entry.g1 || 0;
    const g2 = entry.g2 || 0;
    const total = g1 + g2 || 1;
    // leftNum = 1 → g1 ; leftNum = 2 → g2
    const leftG  = leftNum === 1 ? g1 : g2;
    const rightG = leftNum === 1 ? g2 : g1;
    const diff = Math.abs(leftG - rightG);
    const leader = leftG >= rightG ? "left" : "right";
    return {
      leftWidth: Math.round((leftG / total) * 100),
      goldDiff: diff,
      goldLeader: leader,
    };
  }, [goldTimeline, matchSec, leftNum]);

  // Auto-scroll vers le dernier event
  const prevVisibleLen = useRef(0);
  useEffect(() => {
    if (visibleEvents.length > prevVisibleLen.current && feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
    prevVisibleLen.current = visibleEvents.length;
  }, [visibleEvents.length]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: "14px 18px", maxHeight: "85vh", display: "flex", flexDirection: "column", gap: 10 }}>

      {/* ── Scoreboard header ─────────────────────────────────────────── */}
      <div style={{
        background: "var(--surface)", borderRadius: 8,
        padding: "12px 16px",
        border: "1px solid rgba(255,255,255,0.07)",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>

          {/* Gauche = user */}
          <div style={{ textAlign: "center", minWidth: 72 }}>
            <div style={{ fontSize: 10, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 }}>
              {leftAbbr}
            </div>
            <KillCounter value={leftKills} color="var(--primary)" />
          </div>

          {/* Centre : chrono + barre gold */}
          <div style={{ flex: 1, textAlign: "center", padding: "0 12px" }}>
            {/* Chrono MM:SS */}
            <div style={{
              fontFamily: "monospace",
              fontSize: 28,
              fontWeight: 900,
              color: done ? "var(--secondary)" : "var(--text-primary)",
              letterSpacing: 2,
              marginBottom: 6,
              fontVariantNumeric: "tabular-nums",
            }}>
              {fmtTime(matchSec)}
              {!done && playing && (
                <span style={{
                  display: "inline-block",
                  width: 7, height: 7,
                  borderRadius: "50%",
                  background: "var(--danger)",
                  marginLeft: 6,
                  verticalAlign: "middle",
                  animation: "pulse 1.1s ease-in-out infinite",
                }} />
              )}
            </div>

            {/* Barre gold bicolore */}
            <div style={{
              height: 7, borderRadius: 4, overflow: "hidden",
              background: "var(--danger)",
              position: "relative",
            }}>
              <motion.div
                animate={{ width: `${leftWidth}%` }}
                transition={{ duration: 0.5, ease: "easeOut" }}
                style={{
                  height: "100%",
                  background: "var(--primary)",
                  borderRadius: "4px 0 0 4px",
                }}
              />
            </div>

            {/* Label gold diff */}
            <div style={{
              fontSize: 10, color: "var(--text-secondary)",
              marginTop: 3, minHeight: 14,
            }}>
              {goldDiff > 800 && (
                <span>
                  <span style={{
                    fontWeight: 700,
                    color: goldLeader === "left" ? "var(--primary)" : "var(--danger)",
                  }}>
                    {goldLeader === "left" ? leftAbbr : rightAbbr}
                  </span>
                  {" "}+{(goldDiff / 1000).toFixed(1)}k gold
                </span>
              )}
            </div>
          </div>

          {/* Droite = adversaire */}
          <div style={{ textAlign: "center", minWidth: 72 }}>
            <div style={{ fontSize: 10, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 }}>
              {rightAbbr}
            </div>
            <KillCounter value={rightKills} color="var(--danger)" />
          </div>
        </div>

        {/* Phase badge */}
        {currentPhase && (
          <div style={{
            textAlign: "center",
            marginTop: 6,
            fontSize: 11,
            color: "var(--text-secondary)",
          }}>
            {{ "Early Game": "🌅", "Mid Game": "⚔️", "Late Game": "🏰" }[currentPhase.name] || "📍"}{" "}
            <span style={{ fontWeight: 600 }}>{currentPhase.name}</span>
            {currentPhase.gold_diff > 0 && (
              <span style={{
                marginLeft: 8, color: tc(currentPhase.advantage), fontWeight: 700,
              }}>
                {tn(currentPhase.advantage)} +{(currentPhase.gold_diff / 1000).toFixed(1)}k
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Contrôles ─────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 5, justifyContent: "center", flexShrink: 0 }}>
        {SPEEDS.map((s, i) => (
          <button key={s.label}
            onClick={() => { setSpeedIdx(i); if (!done) setPlaying(true); }}
            style={{
              padding: "4px 13px", borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: "pointer",
              border: `1px solid ${speedIdx === i ? "var(--secondary)" : "rgba(255,255,255,0.14)"}`,
              background: speedIdx === i ? "rgba(255,184,0,0.12)" : "transparent",
              color: speedIdx === i ? "var(--secondary)" : "var(--text-secondary)",
              transition: "all 0.15s",
            }}
          >
            {s.label}
          </button>
        ))}
        {!done && (
          <button onClick={() => setPlaying(p => !p)}
            style={{
              padding: "4px 10px", borderRadius: 20, fontSize: 13, fontWeight: 700,
              cursor: "pointer",
              border: "1px solid rgba(255,255,255,0.14)",
              background: "transparent",
              color: "var(--text-secondary)",
            }}
          >
            {playing ? "⏸" : "▶"}
          </button>
        )}
        <button onClick={handleSkip} disabled={done}
          style={{
            padding: "4px 13px", borderRadius: 20, fontSize: 12, fontWeight: 700,
            cursor: done ? "default" : "pointer",
            border: "1px solid rgba(255,255,255,0.14)",
            background: "transparent",
            color: done ? "rgba(255,255,255,0.2)" : "var(--text-secondary)",
          }}
        >
          ⏭ Skip
        </button>
      </div>

      {/* ── Feed d'events ─────────────────────────────────────────────── */}
      <div
        ref={feedRef}
        style={{
          flex: 1,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 4,
          minHeight: 180,
          maxHeight: 340,
          paddingRight: 4,
        }}
      >
        <AnimatePresence initial={false}>
          {visibleEvents.map((item, i) => (
            <EventRow
              key={`${item.type}-${item.time}-${i}`}
              item={item}
              tc={tc}
              tn={tn}
            />
          ))}
        </AnimatePresence>

        {!done && playing && (
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "6px 10px", color: "var(--text-secondary)", fontSize: 11,
          }}>
            <motion.span
              animate={{ opacity: [0.2, 1, 0.2] }}
              transition={{ duration: 1.1, repeat: Infinity }}
            >●</motion.span>
            Simulation en cours…
          </div>
        )}
      </div>

      {/* ── Scoreboard joueurs (après fin) ────────────────────────────── */}
      {done && (leftStats.length > 0 || rightStats.length > 0) && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          style={{ flexShrink: 0 }}
        >
          <div style={{
            fontSize: 11, fontWeight: 700, textTransform: "uppercase",
            letterSpacing: 1, color: "var(--text-secondary)", marginBottom: 8,
          }}>
            Scoreboard
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {[
              { stats: leftStats,  won: userWon,  abbr: leftAbbr  },
              { stats: rightStats, won: !userWon, abbr: rightAbbr },
            ].map(({ stats, won, abbr }, teamIdx) => (
              <div key={teamIdx} style={{ background: "var(--surface)", borderRadius: 6, overflow: "hidden" }}>
                <div style={{
                  padding: "6px 12px", fontWeight: 700, fontSize: 12,
                  background: won ? "var(--primary)" : "var(--danger)",
                  color: won ? "black" : "white",
                }}>
                  {abbr} — {won ? "Victoire ✓" : "Défaite"}
                </div>
                <div style={{
                  display: "grid", gridTemplateColumns: "26px 1fr 70px 36px 44px 46px",
                  padding: "5px 10px", gap: 2,
                  fontSize: 10, color: "var(--text-secondary)", fontWeight: 600, textTransform: "uppercase",
                }}>
                  <span /><span>Joueur</span>
                  <span style={{ textAlign: "center" }}>K/D/A</span>
                  <span style={{ textAlign: "center" }}>Note</span>
                  <span style={{ textAlign: "center" }}>CS/m</span>
                  <span style={{ textAlign: "right" }}>DMG</span>
                </div>
                {stats.map((p, i) => {
                  const note   = calcNote(p, duration, won);
                  const isGood = note >= 7, isBad = note <= 3;
                  return (
                    <div key={i} style={{
                      display: "grid", gridTemplateColumns: "26px 1fr 70px 36px 44px 46px",
                      padding: "5px 10px", gap: 2,
                      borderTop: "1px solid var(--border-subtle)", alignItems: "center",
                    }}>
                      {p.champion ? (
                        <img loading="lazy"
                          src={`https://ddragon.leagueoflegends.com/cdn/${_ddVersion}/img/champion/${toDDragonKey(p.champion)}.png`}
                          alt={p.champion} title={p.champion}
                          style={{ width: 22, height: 22, borderRadius: 3 }}
                          onError={e => { e.currentTarget.style.display = "none"; }}
                        />
                      ) : <span />}
                      <span style={{ fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {p.player_name || `Joueur ${i + 1}`}
                      </span>
                      <span style={{ textAlign: "center", fontSize: 11, fontWeight: 700 }}>
                        <span style={{ color: "var(--success)" }}>{p.kills}</span>
                        <span style={{ color: "var(--text-secondary)" }}>/</span>
                        <span style={{ color: "var(--danger)" }}>{p.deaths}</span>
                        <span style={{ color: "var(--text-secondary)" }}>/</span>
                        <span style={{ color: "var(--primary)" }}>{p.assists}</span>
                      </span>
                      <span style={{
                        textAlign: "center", fontSize: 11, fontWeight: 700,
                        color: isGood ? "var(--success)" : isBad ? "var(--danger)" : "var(--primary)",
                      }}>
                        {note.toFixed(1)}
                      </span>
                      <span style={{ textAlign: "center", fontSize: 11 }}>
                        {duration ? (p.cs / Math.max(1, duration)).toFixed(1) : "-"}
                      </span>
                      <span style={{ textAlign: "right", fontSize: 11, color: "var(--secondary)" }}>
                        {p.damage ? (p.damage / 1000).toFixed(1) + "k" : "-"}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* ── Bouton continuer ──────────────────────────────────────────── */}
      {done && (
        <motion.button
          className="btn-primary"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          style={{ width: "100%", padding: 14, fontSize: 15, flexShrink: 0 }}
          onClick={onContinue}
        >
          Voir le résultat final →
        </motion.button>
      )}
    </div>
  );
};

export default MatchTimeline;

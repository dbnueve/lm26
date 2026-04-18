import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  SPEEDS, TICK_MS, KILL_TYPES, parseSec, fmtTime,
} from "./timelineHelpers";
import { _ddVersion, toDDragonKey } from "./ddHelpers";
import TimelineEventRow from "./TimelineEventRow";
import TimelineKillCounter from "./TimelineKillCounter";
import TimelineScoreboard from "./TimelineScoreboard";

const DRAKE_ICONS = {
  infernal: "🔥", mountain: "🪨", ocean: "🌊", cloud: "💨",
  hextech: "⚡", chemtech: "☣️", elder: "🟣",
};

function getDrakeIcon(desc) {
  if (!desc) return "🐉";
  const lower = desc.toLowerCase();
  for (const [key, icon] of Object.entries(DRAKE_ICONS)) {
    if (lower.includes(key)) return icon;
  }
  return "🐉";
}

// Death timer LoL: BRT formula — increases with game time
function calcDeathTimer(deathSec) {
  const min = deathSec / 60;
  let baseTimer;
  if (min < 15) baseTimer = 10;
  else if (min < 30) baseTimer = 10 + Math.floor((min - 15) * 1.2);
  else if (min < 45) baseTimer = 28 + Math.floor((min - 30) * 2.0);
  else baseTimer = 58 + Math.floor((min - 45) * 2.5);
  return Math.min(baseTimer, 90);
}

function ChampionPanel({ stats, visibleEvents, matchSec, teamNum, side, tc }) {
  const color = tc(teamNum);
  const isLeft = side === "left";

  // Map: champion → { deathSec, respawnSec } pour le dernier kill
  const deathMap = useMemo(() => {
    const map = {};
    visibleEvents.forEach(ev => {
      if ((ev.type === "kill" || ev.type === "first_blood") && ev.victim_champion) {
        const vc = ev.victim_champion;
        // Vérifie que la victime appartient à l'équipe de ce panel
        const isOurTeam = stats.some(p => p.champion === vc);
        if (isOurTeam) {
          const deathSec = parseSec(ev.time);
          const timer = calcDeathTimer(deathSec);
          map[vc] = { deathSec, respawnSec: deathSec + timer };
        }
      }
    });
    return map;
  }, [visibleEvents, stats]);

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: isLeft ? "flex-end" : "flex-start",
      gap: 4,
      minWidth: 38,
      flexShrink: 0,
    }}>
      {stats.map((p, i) => {
        const death = deathMap[p.champion];
        const isDead = death && matchSec >= death.deathSec && matchSec < death.respawnSec;
        const remainSec = isDead ? Math.ceil(death.respawnSec - matchSec) : 0;
        const ddKey = toDDragonKey(p.champion || "");
        return (
          <div key={i} style={{ position: "relative", width: 32, height: 32 }}>
            <img
              src={`https://ddragon.leagueoflegends.com/cdn/${_ddVersion}/img/champion/${ddKey}.png`}
              alt={p.champion}
              title={`${p.player_name} — ${p.champion}`}
              style={{
                width: 32, height: 32,
                borderRadius: 4,
                border: `1.5px solid ${isDead ? "rgba(255,255,255,0.08)" : color + "88"}`,
                filter: isDead ? "grayscale(1) brightness(0.3)" : "none",
                transition: "filter 0.3s ease",
                display: "block",
              }}
              onError={e => { e.currentTarget.style.display = "none"; }}
            />
            {isDead && (
              <div style={{
                position: "absolute", inset: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                flexDirection: "column",
                background: "rgba(0,0,0,0.55)",
                borderRadius: 4,
                pointerEvents: "none",
              }}>
                <span style={{ fontSize: 9, fontFamily: "monospace", fontWeight: 900, color: "#ef4444", lineHeight: 1 }}>
                  {remainSec}s
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ObjectivesBar({ events, teamNum, side, tc }) {
  const color = tc(teamNum);
  const isLeft = side === "left";

  const towers = useMemo(
    () => events.filter(e => (e.type === "tower" || e.type === "first_tower") && e.team === teamNum).length,
    [events, teamNum]
  );
  const drakes = useMemo(
    () => events.filter(e => e.type === "drake" && e.team === teamNum),
    [events, teamNum]
  );
  const baron = useMemo(
    () => events.filter(e => e.type === "baron" && e.team === teamNum).length,
    [events, teamNum]
  );
  const herald = useMemo(
    () => events.filter(e => e.type === "herald" && e.team === teamNum).length,
    [events, teamNum]
  );

  return (
    <div style={{
      display: "flex",
      flexDirection: isLeft ? "row-reverse" : "row",
      alignItems: "center",
      gap: 4,
      flexWrap: "wrap",
      minWidth: 50,
    }}>
      {towers > 0 && (
        <span title={`${towers} tour(s)`} style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 1, color: "var(--text-2)" }}>
          🏯<span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 11, color }}>{towers}</span>
        </span>
      )}
      {drakes.map((ev, i) => (
        <span key={i} title={ev.description || "Drake"} style={{ fontSize: 14, lineHeight: 1 }}>
          {getDrakeIcon(ev.description)}
        </span>
      ))}
      {baron > 0 && Array.from({ length: baron }).map((_, i) => (
        <span key={i} title="Baron" style={{ fontSize: 14, lineHeight: 1 }}>👑</span>
      ))}
      {herald > 0 && Array.from({ length: herald }).map((_, i) => (
        <span key={i} title="Herald" style={{ fontSize: 14, lineHeight: 1 }}>🔮</span>
      ))}
    </div>
  );
}

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
  duration = 30,
  winnerTeam = 0,
  userIsTeam1 = true,
  onContinue,
}) => {
  const leftNum = userIsTeam1 ? 1 : 2;
  const rightNum = userIsTeam1 ? 2 : 1;
  const leftAbbr = userIsTeam1 ? team1Abbr : team2Abbr;
  const rightAbbr = userIsTeam1 ? team2Abbr : team1Abbr;
  const leftStats = userIsTeam1 ? team1Stats : team2Stats;
  const rightStats = userIsTeam1 ? team2Stats : team1Stats;
  const userWon = winnerTeam === leftNum;

  const tc = useCallback((n) => n === 1 ? "var(--accent)" : "var(--danger)", []);
  const tn = useCallback((n) => n === 1 ? team1Abbr : team2Abbr, [team1Abbr, team2Abbr]);

  const endSec = useMemo(() => {
    const endEv = events.find(e => e.type === "game_end");
    if (endEv) {
      const s = parseSec(endEv.time);
      if (s > 0) return s;
    }
    return Math.max(duration, 20) * 60;
  }, [events, duration]);

  const [matchSec, setMatchSec] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [done, setDone] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(0);

  const intervalRef = useRef(null);
  const feedRef = useRef(null);

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

  const handleSkip = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    setMatchSec(endSec);
    setDone(true);
    setPlaying(false);
  }, [endSec]);

  const sortedEvents = useMemo(
    () => [...events].sort((a, b) => parseSec(a.time) - parseSec(b.time)),
    [events]
  );

  const visibleEvents = useMemo(
    () => sortedEvents.filter(e => parseSec(e.time) <= matchSec),
    [sortedEvents, matchSec]
  );

  const leftKills = useMemo(
    () => visibleEvents.filter(e => KILL_TYPES.has(e.type) && e.team === leftNum).length,
    [visibleEvents, leftNum]
  );
  const rightKills = useMemo(
    () => visibleEvents.filter(e => KILL_TYPES.has(e.type) && e.team === rightNum).length,
    [visibleEvents, rightNum]
  );

  const { leftWidth, goldDiff, goldLeader } = useMemo(() => {
    if (!goldTimeline || goldTimeline.length === 0) {
      return { leftWidth: 50, goldDiff: 0, goldLeader: null };
    }
    const curMin = Math.min(Math.floor(matchSec / 60), goldTimeline.length - 1);
    const entry = goldTimeline[curMin] || goldTimeline[goldTimeline.length - 1];
    const g1 = entry.g1 || 0;
    const g2 = entry.g2 || 0;
    const total = g1 + g2 || 1;
    const leftG = leftNum === 1 ? g1 : g2;
    const rightG = leftNum === 1 ? g2 : g1;
    const diff = Math.abs(leftG - rightG);
    const leader = leftG >= rightG ? "left" : "right";
    return {
      leftWidth: Math.round((leftG / total) * 100),
      goldDiff: diff,
      goldLeader: leader,
    };
  }, [goldTimeline, matchSec, leftNum]);

  const prevVisibleLen = useRef(0);
  useEffect(() => {
    if (visibleEvents.length > prevVisibleLen.current && feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
    prevVisibleLen.current = visibleEvents.length;
  }, [visibleEvents.length]);

  return (
    <div style={{ padding: "14px 18px", maxHeight: "85vh", display: "flex", flexDirection: "column", gap: 10 }}>

      {/* Scoreboard header */}
      <div style={{
        background: "var(--surface-1)", borderRadius: 8, padding: "12px 10px",
        border: "1px solid rgba(255,255,255,0.07)", flexShrink: 0,
      }}>
        {/* Ligne kills + timer + gold */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
          {/* Gauche : kills */}
          <div style={{ textAlign: "center", minWidth: 64 }}>
            <div style={{ fontSize: 10, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 }}>
              {leftAbbr}
            </div>
            <TimelineKillCounter value={leftKills} color="var(--accent)" />
          </div>

          {/* Centre : timer + barre gold */}
          <div style={{ flex: 1, textAlign: "center", padding: "0 8px" }}>
            <div style={{
              fontFamily: "monospace", fontSize: 26, fontWeight: 900,
              color: done ? "var(--amber)" : "var(--text-1)",
              letterSpacing: 2, marginBottom: 6, fontVariantNumeric: "tabular-nums",
            }}>
              {fmtTime(matchSec)}
              {!done && playing && (
                <span style={{
                  display: "inline-block", width: 7, height: 7, borderRadius: "50%",
                  background: "var(--danger)", marginLeft: 6, verticalAlign: "middle",
                  animation: "pulse 1.1s ease-in-out infinite",
                }} />
              )}
            </div>

            <div style={{
              height: 7, borderRadius: 4, overflow: "hidden",
              background: "var(--danger)", position: "relative",
            }}>
              <motion.div
                animate={{ width: `${leftWidth}%` }}
                transition={{ duration: 0.5, ease: "easeOut" }}
                style={{ height: "100%", background: "var(--accent)", borderRadius: "4px 0 0 4px" }}
              />
            </div>

            <div style={{ fontSize: 10, color: "var(--text-2)", marginTop: 3, minHeight: 14 }}>
              {goldDiff > 200 ? (
                <span>
                  <span style={{
                    fontWeight: 700,
                    color: goldLeader === "left" ? "var(--accent)" : "var(--danger)",
                  }}>
                    {goldLeader === "left" ? leftAbbr : rightAbbr}
                  </span>
                  {" "}+{(goldDiff / 1000).toFixed(1)}k gold
                </span>
              ) : (
                <span>Égalité</span>
              )}
            </div>
          </div>

          {/* Droite : kills */}
          <div style={{ textAlign: "center", minWidth: 64 }}>
            <div style={{ fontSize: 10, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 }}>
              {rightAbbr}
            </div>
            <TimelineKillCounter value={rightKills} color="var(--danger)" />
          </div>
        </div>

        {/* Ligne champions + objectifs */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "flex-start",
          marginTop: 10, gap: 6,
        }}>
          {/* Champions gauche */}
          <ChampionPanel
            stats={leftStats}
            visibleEvents={visibleEvents}
            matchSec={matchSec}
            teamNum={leftNum}
            side="left"
            tc={tc}
          />

          {/* Objectifs gauche */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flex: 1 }}>
            <ObjectivesBar events={visibleEvents} teamNum={leftNum} side="left" tc={tc} />
          </div>

          {/* Séparateur central */}
          <div style={{ width: 1, background: "rgba(255,255,255,0.08)", alignSelf: "stretch", margin: "0 4px" }} />

          {/* Objectifs droite */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4, flex: 1 }}>
            <ObjectivesBar events={visibleEvents} teamNum={rightNum} side="right" tc={tc} />
          </div>

          {/* Champions droite */}
          <ChampionPanel
            stats={rightStats}
            visibleEvents={visibleEvents}
            teamNum={rightNum}
            side="right"
            tc={tc}
          />
        </div>
      </div>

      {/* Contrôles */}
      <div style={{ display: "flex", gap: 5, justifyContent: "center", flexShrink: 0 }}>
        {SPEEDS.map((s, i) => (
          <button key={s.label}
            onClick={() => { setSpeedIdx(i); if (!done) setPlaying(true); }}
            style={{
              padding: "4px 13px", borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: "pointer",
              border: `1px solid ${speedIdx === i ? "var(--amber)" : "rgba(255,255,255,0.14)"}`,
              background: speedIdx === i ? "rgba(255,184,0,0.12)" : "transparent",
              color: speedIdx === i ? "var(--amber)" : "var(--text-2)",
              transition: "all 0.15s",
            }}
          >
            {s.label}
          </button>
        ))}
        {!done && (
          <button onClick={() => setPlaying(p => !p)}
            style={{
              padding: "4px 10px", borderRadius: 20, fontSize: 13, fontWeight: 700, cursor: "pointer",
              border: "1px solid rgba(255,255,255,0.14)", background: "transparent", color: "var(--text-2)",
            }}
          >
            {playing ? "⏸" : "▶"}
          </button>
        )}
        <button onClick={handleSkip} disabled={done}
          style={{
            padding: "4px 13px", borderRadius: 20, fontSize: 12, fontWeight: 700,
            cursor: done ? "default" : "pointer",
            border: "1px solid rgba(255,255,255,0.14)", background: "transparent",
            color: done ? "rgba(255,255,255,0.2)" : "var(--text-2)",
          }}
        >
          ⏭ Skip
        </button>
      </div>

      {/* Feed */}
      <div
        ref={feedRef}
        style={{
          flex: 1, overflowY: "auto", display: "flex", flexDirection: "column",
          gap: 4, minHeight: 180, maxHeight: 340, paddingRight: 4,
        }}
      >
        <AnimatePresence initial={false}>
          {visibleEvents.map((item, i) => (
            <TimelineEventRow
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
            padding: "6px 10px", color: "var(--text-2)", fontSize: 11,
          }}>
            <motion.span
              animate={{ opacity: [0.2, 1, 0.2] }}
              transition={{ duration: 1.1, repeat: Infinity }}
            >●</motion.span>
            Simulation en cours…
          </div>
        )}
      </div>

      {/* Scoreboard joueurs */}
      {done && (leftStats.length > 0 || rightStats.length > 0) && (
        <TimelineScoreboard
          leftStats={leftStats}
          rightStats={rightStats}
          leftAbbr={leftAbbr}
          rightAbbr={rightAbbr}
          userWon={userWon}
          duration={duration}
        />
      )}

      {/* Continuer */}
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

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  SPEEDS, TICK_MS, KILL_TYPES, parseSec, fmtTime, calcNote,
} from "./timelineHelpers";
import { _ddVersion, toDDragonKey } from "./ddHelpers";
import TeamLogo from "./TeamLogo";
import TimelineEventRow from "./TimelineEventRow";
import TimelineKillCounter from "./TimelineKillCounter";
import MiniMap from "./MiniMap";
/* ─── Constantes ──────────────────────────────────────────────── */

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

// Death timer LoL (BRT formula)
function calcDeathTimer(deathSec) {
  const min = deathSec / 60;
  let t;
  if (min < 15) t = 10;
  else if (min < 30) t = 10 + Math.floor((min - 15) * 1.2);
  else if (min < 45) t = 28 + Math.floor((min - 30) * 2.0);
  else t = 58 + Math.floor((min - 45) * 2.5);
  return Math.min(t, 90);
}

/* ─── ChampionColumn : icônes verticales avec death timer ────── */

function ChampionColumn({ stats, visibleEvents, matchSec, teamNum, side, tc }) {
  const color = tc(teamNum);

  const deathMap = useMemo(() => {
    const map = {};
    visibleEvents.forEach(ev => {
      if ((ev.type === "kill" || ev.type === "first_blood") && ev.victim_champion) {
        const vc = ev.victim_champion;
        if (stats.some(p => p.champion === vc)) {
          const deathSec = parseSec(ev.time);
          map[vc] = { deathSec, respawnSec: deathSec + calcDeathTimer(deathSec) };
        }
      }
    });
    return map;
  }, [visibleEvents, stats]);

  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 3,
      alignItems: side === "left" ? "flex-end" : "flex-start",
    }}>
      {stats.map((p, i) => {
        const death = deathMap[p.champion];
        const isDead = death && matchSec >= death.deathSec && matchSec < death.respawnSec;
        const remainSec = isDead ? Math.ceil(death.respawnSec - matchSec) : 0;
        const ddKey = toDDragonKey(p.champion || "");
        return (
          <div key={i} style={{ position: "relative", width: 30, height: 30, flexShrink: 0 }}>
            <img
              src={`https://ddragon.leagueoflegends.com/cdn/${_ddVersion}/img/champion/${ddKey}.png`}
              alt={p.champion}
              title={`${p.player_name} — ${p.champion}`}
              style={{
                width: 30, height: 30, borderRadius: 4, display: "block",
                border: `1.5px solid ${isDead ? "rgba(255,255,255,0.06)" : color + "99"}`,
                filter: isDead ? "grayscale(1) brightness(0.25)" : "none",
                transition: "filter 0.3s ease",
              }}
              onError={e => { e.currentTarget.style.display = "none"; }}
            />
            {isDead && (
              <div style={{
                position: "absolute", inset: 0, borderRadius: 4,
                background: "rgba(0,0,0,0.6)",
                display: "flex", alignItems: "center", justifyContent: "center",
                pointerEvents: "none",
              }}>
                <span style={{ fontSize: 9, fontFamily: "monospace", fontWeight: 900, color: "#ef4444" }}>
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

/* ─── ObjectivePips : icônes drakes/baron/herald ─────────────── */

function ObjectivePips({ events, teamNum }) {
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
  const towers = useMemo(
    () => events.filter(e => (e.type === "tower" || e.type === "first_tower") && e.team === teamNum).length,
    [events, teamNum]
  );

  const hasAny = drakes.length + baron + herald + towers > 0;
  if (!hasAny) return null;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 2, justifyContent: "center" }}>
      {towers > 0 && (
        <span style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 1 }}>
          🏯<span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 10, color: "var(--text-2)" }}>{towers}</span>
        </span>
      )}
      {drakes.map((ev, i) => (
        <span key={i} title={ev.description || "Drake"} style={{ fontSize: 13, lineHeight: 1 }}>
          {getDrakeIcon(ev.description)}
        </span>
      ))}
      {Array.from({ length: baron }).map((_, i) => (
        <span key={i} title="Baron" style={{ fontSize: 13, lineHeight: 1 }}>👑</span>
      ))}
      {Array.from({ length: herald }).map((_, i) => (
        <span key={i} title="Herald" style={{ fontSize: 13, lineHeight: 1 }}>🔮</span>
      ))}
    </div>
  );
}

/* ─── LiveScoreboard : KDA en temps réel ─────────────────────── */

function LiveScoreboard({ leftStats, rightStats, leftAbbr, rightAbbr,
                          visibleEvents, winnerTeam, leftNum, duration }) {
  // Kills/deaths/assists live par champion à partir des events visibles
  const liveKda = useMemo(() => {
    const kda = {};
    visibleEvents.forEach(ev => {
      if (!KILL_TYPES.has(ev.type)) return;
      // Killer
      if (ev.killer_champion) {
        if (!kda[ev.killer_champion]) kda[ev.killer_champion] = { k: 0, d: 0, a: 0 };
        kda[ev.killer_champion].k += 1;
      }
      // Victim
      if (ev.victim_champion) {
        if (!kda[ev.victim_champion]) kda[ev.victim_champion] = { k: 0, d: 0, a: 0 };
        kda[ev.victim_champion].d += 1;
      }
    });
    return kda;
  }, [visibleEvents]);

  const renderTeam = (stats, abbr, isWinner) => (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{
        padding: "4px 8px", fontSize: 10, fontWeight: 700, textTransform: "uppercase",
        letterSpacing: 1, background: isWinner ? "var(--accent)" : "var(--danger)",
        color: isWinner ? "#000" : "#fff", borderRadius: "4px 4px 0 0",
      }}>
        {abbr}
      </div>
      <div style={{ background: "var(--surface-1)", borderRadius: "0 0 4px 4px" }}>
        {/* Header */}
        <div style={{
          display: "grid", gridTemplateColumns: "22px 1fr 52px 36px",
          padding: "3px 8px", gap: 2,
          fontSize: 9, color: "var(--text-2)", fontWeight: 600, textTransform: "uppercase",
          borderBottom: "1px solid var(--border)",
        }}>
          <span /><span>Joueur</span>
          <span style={{ textAlign: "center" }}>K/D/A</span>
          <span style={{ textAlign: "center" }}>Note</span>
        </div>
        {stats.map((p, i) => {
          const live = liveKda[p.champion] || { k: 0, d: 0, a: 0 };
          // Note calculée sur les stats finales mais kills/deaths live pour feedback immédiat
          const liveP = { ...p, kills: live.k, deaths: live.d, assists: live.a };
          const note = calcNote(liveP, duration || 30, isWinner);
          const isGood = note >= 7, isBad = note <= 3;
          return (
            <div key={i} style={{
              display: "grid", gridTemplateColumns: "22px 1fr 52px 36px",
              padding: "4px 8px", gap: 2, alignItems: "center",
              borderTop: i > 0 ? "1px solid var(--border)" : "none",
            }}>
              {p.champion ? (
                <img
                  src={`https://ddragon.leagueoflegends.com/cdn/${_ddVersion}/img/champion/${toDDragonKey(p.champion)}.png`}
                  alt={p.champion}
                  style={{ width: 20, height: 20, borderRadius: 3 }}
                  onError={e => { e.currentTarget.style.display = "none"; }}
                />
              ) : <span />}
              <span style={{ fontSize: 11, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {p.player_name || `J${i + 1}`}
              </span>
              <span style={{ textAlign: "center", fontSize: 10, fontWeight: 700, fontFamily: "monospace" }}>
                <span style={{ color: "var(--success)" }}>{live.k}</span>
                <span style={{ color: "var(--text-2)" }}>/</span>
                <span style={{ color: "var(--danger)" }}>{live.d}</span>
                <span style={{ color: "var(--text-2)" }}>/</span>
                <span style={{ color: "var(--accent)" }}>{live.a}</span>
              </span>
              <span style={{
                textAlign: "center", fontSize: 10, fontWeight: 700,
                color: isGood ? "var(--success)" : isBad ? "var(--danger)" : "var(--accent)",
              }}>
                {note.toFixed(1)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
      {renderTeam(leftStats, leftAbbr, winnerTeam === leftNum)}
      {renderTeam(rightStats, rightAbbr, winnerTeam !== leftNum)}
    </div>
  );
}

/* ─── MatchTimeline (composant principal) ────────────────────── */

/**
 * Props
 *   phases, events, goldTimeline     : données du match
 *   team1Abbr / team2Abbr            : abréviations
 *   team1Id / team2Id                : IDs pour TeamLogo
 *   team1Stats / team2Stats          : stats joueurs
 *   duration                         : durée en minutes
 *   winnerTeam                       : 1 ou 2
 *   userIsTeam1                      : true si l'user est team1
 *   onContinue                       : callback fin de timeline
 */
const MatchTimeline = ({
  phases = [], events = [], goldTimeline = [],
  team1Abbr, team2Abbr,
  team1Id, team2Id,
  team1Stats = [], team2Stats = [],
  duration = 30,
  winnerTeam = 0,
  userIsTeam1 = true,
  onContinue,
}) => {
  const leftNum  = userIsTeam1 ? 1 : 2;
  const rightNum = userIsTeam1 ? 2 : 1;
  const leftAbbr  = userIsTeam1 ? team1Abbr : team2Abbr;
  const rightAbbr = userIsTeam1 ? team2Abbr : team1Abbr;
  const leftId    = userIsTeam1 ? team1Id : team2Id;
  const rightId   = userIsTeam1 ? team2Id : team1Id;
  const leftStats  = userIsTeam1 ? team1Stats : team2Stats;
  const rightStats = userIsTeam1 ? team2Stats : team1Stats;

  const tc = useCallback((n) => n === 1 ? "var(--accent)" : "var(--danger)", []);
  const tn = useCallback((n) => n === 1 ? team1Abbr : team2Abbr, [team1Abbr, team2Abbr]);

  const endSec = useMemo(() => {
    const endEv = events.find(e => e.type === "game_end");
    if (endEv) { const s = parseSec(endEv.time); if (s > 0) return s; }
    return Math.max(duration, 20) * 60;
  }, [events, duration]);

  const [matchSec, setMatchSec] = useState(0);
  const [playing, setPlaying]   = useState(true);
  const [done, setDone]         = useState(false);
  const [speedIdx, setSpeedIdx] = useState(0);

  const intervalRef = useRef(null);
  const feedRef     = useRef(null);

  useEffect(() => {
    if (!playing || done) {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      return;
    }
    intervalRef.current = setInterval(() => {
      setMatchSec(s => {
        const next = s + SPEEDS[speedIdx].step;
        if (next >= endSec) { setDone(true); setPlaying(false); return endSec; }
        return next;
      });
    }, TICK_MS);
    return () => { if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; } };
  }, [playing, done, speedIdx, endSec]);

  const handleSkip = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    setMatchSec(endSec); setDone(true); setPlaying(false);
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
    if (!goldTimeline || goldTimeline.length === 0) return { leftWidth: 50, goldDiff: 0, goldLeader: null };
    const curMin = Math.min(Math.floor(matchSec / 60), goldTimeline.length - 1);
    const entry  = goldTimeline[curMin] || goldTimeline[goldTimeline.length - 1];
    const g1 = entry.g1 || 0, g2 = entry.g2 || 0;
    const total = g1 + g2 || 1;
    const leftG  = leftNum === 1 ? g1 : g2;
    const rightG = leftNum === 1 ? g2 : g1;
    return {
      leftWidth:  Math.round((leftG / total) * 100),
      goldDiff:   Math.abs(leftG - rightG),
      goldLeader: leftG >= rightG ? "left" : "right",
    };
  }, [goldTimeline, matchSec, leftNum]);

  // Auto-scroll feed
  const prevVisibleLen = useRef(0);
  useEffect(() => {
    if (visibleEvents.length > prevVisibleLen.current && feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
    prevVisibleLen.current = visibleEvents.length;
  }, [visibleEvents.length]);

  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 8,
      padding: "10px 14px", maxHeight: "80vh",
    }}>

      {/* Ligne principale : logo+kills | champions | CARTE | champions | kills+logo */}
<div style={{ display: "flex", alignItems: "center", gap: 8 }}>

  {/* === GAUCHE : Logo + kills + champions === */}
  <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, justifyContent: "flex-end" }}>

    {/* Logo + abbr */}
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flexShrink: 0 }}>
      <TeamLogo teamId={leftId} abbr={leftAbbr} size={36} />
      <span style={{ fontSize: 10, fontWeight: 700, color: "var(--accent)", letterSpacing: 1 }}>
        {leftAbbr}
      </span>
    </div>

    {/* Kills gauche */}
    <TimelineKillCounter value={leftKills} color="var(--accent)" />

    {/* Champions gauche — colonne verticale */}
    <ChampionColumn
      stats={leftStats} visibleEvents={visibleEvents}
      matchSec={matchSec} teamNum={leftNum} side="left" tc={tc}
    />
  </div>

  {/* === CENTRE : Carte minimap === */}
  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flexShrink: 0 }}>
    <MiniMap
      leftStats={leftStats}
      rightStats={rightStats}
      leftNum={leftNum}
      rightNum={rightNum}
      visibleEvents={visibleEvents}
      matchSec={matchSec}
      size={350}
    />
    {/* Timer + barre gold sous la carte */}
    <div style={{ width: 150, textAlign: "center" }}>
      <div style={{
        fontFamily: "monospace", fontSize: 20, fontWeight: 900,
        color: done ? "var(--amber)" : "var(--text-1)",
        letterSpacing: 2, marginBottom: 4, fontVariantNumeric: "tabular-nums",
      }}>
        {fmtTime(matchSec)}
        {!done && playing && (
          <span style={{
            display: "inline-block", width: 6, height: 6, borderRadius: "50%",
            background: "var(--danger)", marginLeft: 5, verticalAlign: "middle",
            animation: "pulse 1.1s ease-in-out infinite",
          }} />
        )}
      </div>
      <div style={{ height: 5, borderRadius: 3, overflow: "hidden", background: "var(--danger)" }}>
        <motion.div
          animate={{ width: `${leftWidth}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          style={{ height: "100%", background: "var(--accent)", borderRadius: "3px 0 0 3px" }}
        />
      </div>
      <div style={{ fontSize: 10, color: "var(--text-2)", marginTop: 3, minHeight: 13 }}>
        {goldDiff > 200 ? (
          <span>
            <span style={{ fontWeight: 700, color: goldLeader === "left" ? "var(--accent)" : "var(--danger)" }}>
              {goldLeader === "left" ? leftAbbr : rightAbbr}
            </span>
            {" "}+{(goldDiff / 1000).toFixed(1)}k gold
          </span>
        ) : <span>Égalité</span>}
      </div>
    </div>
  </div>

  {/* === DROITE : Champions + kills + Logo === */}
  <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, justifyContent: "flex-start" }}>

    {/* Champions droite */}
    <ChampionColumn
      stats={rightStats} visibleEvents={visibleEvents}
      matchSec={matchSec} teamNum={rightNum} side="right" tc={tc}
    />

    {/* Kills droite */}
    <TimelineKillCounter value={rightKills} color="var(--danger)" />

    {/* Logo + abbr */}
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flexShrink: 0 }}>
      <TeamLogo teamId={rightId} abbr={rightAbbr} size={36} />
      <span style={{ fontSize: 10, fontWeight: 700, color: "var(--danger)", letterSpacing: 1 }}>
        {rightAbbr}
      </span>
    </div>
  </div>

</div>
        {/* Objectifs : gauche | séparateur | droite */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
            <ObjectivePips events={visibleEvents} teamNum={leftNum} />
          </div>
          <div style={{ width: 1, height: 16, background: "rgba(255,255,255,0.1)" }} />
          <div style={{ flex: 1, display: "flex", justifyContent: "flex-start" }}>
            <ObjectivePips events={visibleEvents} teamNum={rightNum} />
          </div>
        </div>

        {/* Contrôles playback */}
        <div style={{ display: "flex", gap: 5, justifyContent: "center" }}>
          {SPEEDS.map((s, i) => (
            <button key={s.label}
              onClick={() => { setSpeedIdx(i); if (!done) setPlaying(true); }}
              style={{
                padding: "3px 11px", borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: "pointer",
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
                padding: "3px 9px", borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: "pointer",
                border: "1px solid rgba(255,255,255,0.14)", background: "transparent", color: "var(--text-2)",
              }}
            >
              {playing ? "⏸" : "▶"}
            </button>
          )}
          <button onClick={handleSkip} disabled={done}
            style={{
              padding: "3px 11px", borderRadius: 20, fontSize: 11, fontWeight: 700,
              cursor: done ? "default" : "pointer",
              border: "1px solid rgba(255,255,255,0.14)", background: "transparent",
              color: done ? "rgba(255,255,255,0.2)" : "var(--text-2)",
            }}
          >
            ⏭ Skip
          </button>
        </div>
      

      {/* ── ZONE 2 : Feed événements ──────────────────────────── */}
      <div
        ref={feedRef}
        style={{
          flex: 1, overflowY: "auto",
          display: "flex", flexDirection: "column", gap: 3,
          minHeight: 120, maxHeight: 260, paddingRight: 4,
        }}
      >
        <AnimatePresence initial={false}>
          {visibleEvents.map((item, i) => (
            <TimelineEventRow
              key={`${item.type}-${item.time}-${i}`}
              item={item} tc={tc} tn={tn}
            />
          ))}
        </AnimatePresence>

        {!done && playing && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", color: "var(--text-2)", fontSize: 11 }}>
            <motion.span animate={{ opacity: [0.2, 1, 0.2] }} transition={{ duration: 1.1, repeat: Infinity }}>●</motion.span>
            Simulation en cours…
          </div>
        )}
      </div>

      {/* ── ZONE 3 : Scoreboard live (visible dès le début) ───── */}
      <LiveScoreboard
        leftStats={leftStats}
        rightStats={rightStats}
        leftAbbr={leftAbbr}
        rightAbbr={rightAbbr}
        visibleEvents={visibleEvents}
        winnerTeam={winnerTeam}
        leftNum={leftNum}
        duration={duration}
      />

      {/* ── Bouton continuer ──────────────────────────────────── */}
      {done && (
        <motion.button
          className="btn-primary"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          style={{ width: "100%", padding: 12, fontSize: 14, flexShrink: 0 }}
          onClick={onContinue}
        >
          Voir le résultat final →
        </motion.button>
      )}
    </div>
  );
};

export default MatchTimeline;

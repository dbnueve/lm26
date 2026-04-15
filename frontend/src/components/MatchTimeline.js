import React, { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";

const SPEEDS = [
  { label: "1×", ms: 1400 },
  { label: "2×", ms: 650 },
  { label: "4×", ms: 280 },
];

const PHASE_ICON = { "Early Game": "🌅", "Mid Game": "⚔️", "Late Game": "🏰" };
const EVENT_ICON = { first_blood: "🩸", teamfight: "⚔️", objective: "🏯", baron: "👑", drake: "🐉" };

function parseMin(t) {
  if (!t) return 99;
  return parseInt(String(t).split(":")[0], 10);
}

function buildObjectives(ph) {
  const items = [];
  if (ph.first_blood)   items.push({ label: "First Blood", team: ph.first_blood });
  if (ph.first_drake)   items.push({ label: "1er Drake", team: ph.first_drake });
  if (ph.first_tower)   items.push({ label: "1ère Tour", team: ph.first_tower });
  if (ph.rift_herald)   items.push({ label: "Herald", team: ph.rift_herald });
  if (ph.drakes) {
    const d1 = ph.drakes[1] || 0, d2 = ph.drakes[2] || 0;
    if (d1) items.push({ label: `${d1} Drake${d1 > 1 ? "s" : ""}`, team: 1 });
    if (d2) items.push({ label: `${d2} Drake${d2 > 1 ? "s" : ""}`, team: 2 });
  }
  if (ph.baron)         items.push({ label: "Baron", team: ph.baron });
  if (ph.elder_drake)   items.push({ label: "Elder", team: ph.elder_drake });
  if (ph.towers_destroyed) {
    const t1 = ph.towers_destroyed[1] || 0, t2 = ph.towers_destroyed[2] || 0;
    if (t1) items.push({ label: `${t1} Tour${t1 > 1 ? "s" : ""}`, team: 1 });
    if (t2) items.push({ label: `${t2} Tour${t2 > 1 ? "s" : ""}`, team: 2 });
  }
  return items;
}

const MatchTimeline = ({
  phases = [], events = [],
  team1Abbr, team2Abbr,
  team1Stats = [], team2Stats = [],
  onContinue,
}) => {
  const tc = (n) => n === 1 ? "var(--primary)" : "var(--danger)";
  const tn = (n) => n === 1 ? team1Abbr : team2Abbr;

  // ── Build flat sorted timeline + kill increments ──────────────────────────
  const { tl, killIncs, totalK1, totalK2 } = useMemo(() => {
    const PHASE_MIN = { "Early Game": 0, "Mid Game": 14, "Late Game": 25 };
    const items = [];

    phases.forEach((ph, i) =>
      items.push({ _kind: "phase", _min: PHASE_MIN[ph.name] ?? (i * 14), ...ph })
    );
    events.forEach(ev => {
      if (ev.type === "game_end") return;
      items.push({ _kind: "event", _min: parseMin(ev.time), ...ev });
    });
    items.sort((a, b) => a._min - b._min);

    const endEv = events.find(e => e.type === "game_end");
    if (endEv) items.push({ _kind: "end", _min: parseMin(endEv.time), ...endEv });

    const tK1 = (team1Stats || []).reduce((s, p) => s + (p.kills || 0), 0);
    const tK2 = (team2Stats || []).reduce((s, p) => s + (p.kills || 0), 0);

    // Distribute kills across events
    const incs = items.map(() => [0, 0]);
    let rem1 = tK1, rem2 = tK2;

    items.forEach((it, i) => {
      if (it._kind === "event" && it.type === "first_blood") {
        if (it.team === 1) { incs[i][0] += 1; rem1 = Math.max(0, rem1 - 1); }
        else               { incs[i][1] += 1; rem2 = Math.max(0, rem2 - 1); }
      }
    });

    const tf1 = items.map((it, i) =>
      (it._kind === "event" && it.type === "teamfight" && it.team === 1) ? i : -1
    ).filter(x => x >= 0);
    const tf2 = items.map((it, i) =>
      (it._kind === "event" && it.type === "teamfight" && it.team === 2) ? i : -1
    ).filter(x => x >= 0);

    if (tf1.length) {
      const per = Math.floor(rem1 / tf1.length);
      tf1.forEach((idx, i) => {
        incs[idx][0] += i === tf1.length - 1 ? rem1 - per * i : per;
      });
    }
    if (tf2.length) {
      const per = Math.floor(rem2 / tf2.length);
      tf2.forEach((idx, i) => {
        incs[idx][1] += i === tf2.length - 1 ? rem2 - per * i : per;
      });
    }

    return { tl: items, killIncs: incs, totalK1: tK1, totalK2: tK2 };
  }, [phases, events, team1Stats, team2Stats]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── State ─────────────────────────────────────────────────────────────────
  const [visible, setVisible]       = useState(0);
  const [kills1, setKills1]         = useState(0);
  const [kills2, setKills2]         = useState(0);
  const [speedIdx, setSpeedIdx]     = useState(0);
  const [playing, setPlaying]       = useState(true);
  const [done, setDone]             = useState(false);
  const [currentPhase, setCurrentPhase] = useState(null);

  // ── Playback loop ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!playing || done) return;
    if (visible >= tl.length) { setDone(true); setPlaying(false); return; }

    const timer = setTimeout(() => {
      const item = tl[visible];
      const inc  = killIncs[visible];

      if (inc[0] > 0) setKills1(k => k + inc[0]);
      if (inc[1] > 0) setKills2(k => k + inc[1]);
      if (item._kind === "phase") setCurrentPhase(item);
      if (item._kind === "end" || visible === tl.length - 1) {
        setDone(true); setPlaying(false);
      }

      setVisible(v => v + 1);
    }, SPEEDS[speedIdx].ms);

    return () => clearTimeout(timer);
  }, [playing, visible, speedIdx, done, tl, killIncs]);

  // ── Skip ──────────────────────────────────────────────────────────────────
  const handleSkip = () => {
    setVisible(tl.length);
    setKills1(totalK1);
    setKills2(totalK2);
    if (phases.length > 0) setCurrentPhase(phases[phases.length - 1]);
    setDone(true);
    setPlaying(false);
  };

  // ── Gold bar ──────────────────────────────────────────────────────────────
  const goldDiff = currentPhase?.gold_diff || 0;
  const goldTeam = currentPhase?.advantage || 0;
  const goldOffset = Math.min(28, goldDiff / 500);
  const t1Width = goldTeam === 1 ? 50 + goldOffset : goldTeam === 2 ? 50 - goldOffset : 50;

  return (
    <div style={{ padding: "18px 22px", maxHeight: "82vh", overflowY: "auto" }}>

      {/* ── Kill scoreboard ─────────────────────────────────────────────── */}
      <div style={{
        background: "var(--surface)", borderRadius: 8, padding: "14px 20px",
        marginBottom: 14, border: "1px solid rgba(255,255,255,0.07)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          {/* Team 1 kills */}
          <div style={{ textAlign: "center", minWidth: 70 }}>
            <div style={{ fontSize: 10, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 }}>
              {team1Abbr}
            </div>
            <AnimatePresence mode="popLayout">
              <motion.div
                key={kills1}
                initial={{ scale: 1.5, color: "#4ade80" }}
                animate={{ scale: 1, color: "var(--primary)" }}
                transition={{ duration: 0.3 }}
                style={{ fontSize: 44, fontWeight: 800, lineHeight: 1 }}
              >
                {kills1}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Center: gold bar */}
          <div style={{ flex: 1, textAlign: "center", padding: "0 16px" }}>
            <div style={{ fontSize: 10, color: "var(--text-secondary)", marginBottom: 6 }}>KILLS</div>
            <div style={{
              height: 8, background: "rgba(255,255,255,0.08)", borderRadius: 4,
              overflow: "hidden", position: "relative",
            }}>
              <motion.div
                animate={{ width: `${t1Width}%` }}
                transition={{ duration: 0.7, ease: "easeInOut" }}
                style={{
                  height: "100%", borderRadius: 4,
                  background: "linear-gradient(90deg, var(--primary), #60a5fa)",
                }}
              />
            </div>
            {goldDiff > 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                style={{ fontSize: 10, color: "var(--text-secondary)", marginTop: 4 }}
              >
                <span style={{ color: tc(goldTeam), fontWeight: 700 }}>{tn(goldTeam)}</span>
                {" "}+{(goldDiff / 1000).toFixed(1)}k gold
              </motion.div>
            )}
          </div>

          {/* Team 2 kills */}
          <div style={{ textAlign: "center", minWidth: 70 }}>
            <div style={{ fontSize: 10, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 }}>
              {team2Abbr}
            </div>
            <AnimatePresence mode="popLayout">
              <motion.div
                key={kills2}
                initial={{ scale: 1.5, color: "#f87171" }}
                animate={{ scale: 1, color: "var(--danger)" }}
                transition={{ duration: 0.3 }}
                style={{ fontSize: 44, fontWeight: 800, lineHeight: 1 }}
              >
                {kills2}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* ── Speed controls ───────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 14 }}>
        {SPEEDS.map((s, i) => (
          <button
            key={s.label}
            onClick={() => { setSpeedIdx(i); if (!done) setPlaying(true); }}
            style={{
              padding: "4px 14px", borderRadius: 20, fontSize: 12, fontWeight: 700,
              cursor: "pointer",
              border: `1px solid ${speedIdx === i ? "var(--secondary)" : "rgba(255,255,255,0.14)"}`,
              background: speedIdx === i ? "rgba(255,184,0,0.12)" : "transparent",
              color: speedIdx === i ? "var(--secondary)" : "var(--text-secondary)",
              transition: "all 0.15s",
            }}
          >
            {s.label}
          </button>
        ))}
        <button
          onClick={handleSkip}
          disabled={done}
          style={{
            padding: "4px 14px", borderRadius: 20, fontSize: 12, fontWeight: 700,
            cursor: done ? "default" : "pointer", marginLeft: 4,
            border: "1px solid rgba(255,255,255,0.14)", background: "transparent",
            color: done ? "rgba(255,255,255,0.2)" : "var(--text-secondary)",
          }}
        >
          ⏭ Skip
        </button>
        {!done && (
          <button
            onClick={() => setPlaying(p => !p)}
            style={{
              padding: "4px 12px", borderRadius: 20, fontSize: 13, fontWeight: 700,
              cursor: "pointer",
              border: "1px solid rgba(255,255,255,0.14)", background: "transparent",
              color: "var(--text-secondary)",
            }}
          >
            {playing ? "⏸" : "▶"}
          </button>
        )}
      </div>

      {/* ── Timeline items ───────────────────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {tl.slice(0, visible).map((item, i) => {
          if (item._kind === "phase") {
            const objs = buildObjectives(item);
            return (
              <motion.div
                key={`phase-${i}`}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                style={{
                  background: tc(item.advantage) + "14",
                  border: `1px solid ${tc(item.advantage)}40`,
                  borderRadius: 6, padding: "10px 14px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>
                    {PHASE_ICON[item.name] || "📍"} {item.name}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>{item.duration}</span>
                  <span style={{ fontWeight: 700, fontSize: 12, color: tc(item.advantage) }}>
                    {tn(item.advantage)} · +{(item.gold_diff / 1000).toFixed(1)}k
                  </span>
                </div>
                {objs.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                    {objs.map((obj, j) => (
                      <span key={j} style={{
                        background: tc(obj.team) + "1e",
                        border: `1px solid ${tc(obj.team)}50`,
                        borderRadius: 12, padding: "1px 8px",
                        fontSize: 10, fontWeight: 600, color: tc(obj.team),
                      }}>
                        {tn(obj.team)} — {obj.label}
                      </span>
                    ))}
                  </div>
                )}
              </motion.div>
            );
          }

          if (item._kind === "event") {
            const icon = EVENT_ICON[item.type] || "📌";
            const desc = (item.description || "")
              .replace(/l'équipe 1/gi, team1Abbr)
              .replace(/l'équipe 2/gi, team2Abbr);
            return (
              <motion.div
                key={`ev-${i}`}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.2 }}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "7px 12px", background: "var(--surface)", borderRadius: 4,
                  borderLeft: item.team ? `3px solid ${tc(item.team)}` : "3px solid rgba(255,255,255,0.08)",
                }}
              >
                <span style={{ fontSize: 15 }}>{icon}</span>
                <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--text-secondary)", minWidth: 36 }}>
                  {item.time}
                </span>
                <span style={{ flex: 1, fontSize: 12 }}>{desc}</span>
                {item.team && (
                  <span style={{ fontWeight: 700, color: tc(item.team), fontSize: 11 }}>
                    {tn(item.team)}
                  </span>
                )}
              </motion.div>
            );
          }

          if (item._kind === "end") {
            return (
              <motion.div
                key="end"
                initial={{ opacity: 0, scale: 0.93 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3 }}
                style={{
                  textAlign: "center", padding: "14px",
                  background: "rgba(255,184,0,0.07)", border: "1px solid var(--secondary)",
                  borderRadius: 6, marginTop: 4,
                }}
              >
                <div style={{ fontSize: 22 }}>💥</div>
                <div style={{ fontWeight: 700, fontSize: 15, marginTop: 4 }}>
                  {tn(item.team)} détruit le Nexus à {item.time} !
                </div>
              </motion.div>
            );
          }

          return null;
        })}

        {/* Pulsing indicator while playing */}
        {!done && playing && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", color: "var(--text-secondary)", fontSize: 12 }}>
            <motion.span
              animate={{ opacity: [0.2, 1, 0.2] }}
              transition={{ duration: 1.1, repeat: Infinity }}
            >
              ●
            </motion.span>
            Simulation en cours...
          </div>
        )}
      </div>

      {/* ── Continue button ──────────────────────────────────────────────── */}
      {done && (
        <motion.button
          className="btn-primary"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          style={{ width: "100%", padding: 14, fontSize: 15, marginTop: 16 }}
          onClick={onContinue}
        >
          Voir le résultat final →
        </motion.button>
      )}
    </div>
  );
};

export default MatchTimeline;

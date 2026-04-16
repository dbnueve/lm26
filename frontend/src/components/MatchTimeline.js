import React, { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { _ddVersion, toDDragonKey } from "./ddHelpers";

// ── Constants ─────────────────────────────────────────────────────────────────

const SPEEDS = [
  { label: "1×", ms: 2400 },
  { label: "2×", ms: 1100 },
  { label: "4×", ms: 450 },
];

const PHASE_ICON = { "Early Game": "🌅", "Mid Game": "⚔️", "Late Game": "🏰" };
const EVENT_ICON = { first_blood: "🩸", teamfight: "⚔️", objective: "🏯", baron: "👑", drake: "🐉" };
const CS_EXPECT  = { TOP: 9.0, JUNGLE: 7.5, MID: 9.0, ADC: 9.5, SUPPORT: 0.8 };

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseMin(t) {
  if (!t) return 99;
  return parseInt(String(t).split(":")[0], 10);
}

/** Même formule que MatchSimulation.renderScoreboard */
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

// ── KillCounter : compte progressivement de prev → value ─────────────────────
function KillCounter({ value, color }) {
  const [displayed, setDisplayed] = useState(0);
  const timerRef   = useRef(null);
  const currentRef = useRef(0);

  useEffect(() => {
    const target = value;
    if (currentRef.current === target) return;

    // Nettoyer l'animation précédente
    if (timerRef.current) clearInterval(timerRef.current);

    const diff = target - currentRef.current;
    if (diff <= 0) { currentRef.current = target; setDisplayed(target); return; }

    // ~800ms max total, min 40ms par kill
    const ms = Math.max(40, Math.min(120, 800 / diff));

    timerRef.current = setInterval(() => {
      currentRef.current += 1;
      setDisplayed(currentRef.current);
      if (currentRef.current >= target) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }, ms);

    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <span style={{ fontSize: 44, fontWeight: 800, lineHeight: 1, color }}>
      {displayed}
    </span>
  );
}

function buildObjectives(ph) {
  const items = [];
  if (ph.first_blood)  items.push({ label: "First Blood", team: ph.first_blood });
  if (ph.first_drake)  items.push({ label: "1er Drake",   team: ph.first_drake });
  if (ph.first_tower)  items.push({ label: "1ère Tour",   team: ph.first_tower });
  if (ph.rift_herald)  items.push({ label: "Herald",      team: ph.rift_herald });
  if (ph.drakes) {
    const d1 = ph.drakes[1] || 0, d2 = ph.drakes[2] || 0;
    if (d1) items.push({ label: `${d1} Drake${d1 > 1 ? "s" : ""}`, team: 1 });
    if (d2) items.push({ label: `${d2} Drake${d2 > 1 ? "s" : ""}`, team: 2 });
  }
  if (ph.baron)        items.push({ label: "Baron",  team: ph.baron });
  if (ph.elder_drake)  items.push({ label: "Elder",  team: ph.elder_drake });
  if (ph.towers_destroyed) {
    const t1 = ph.towers_destroyed[1] || 0, t2 = ph.towers_destroyed[2] || 0;
    if (t1) items.push({ label: `${t1} Tour${t1 > 1 ? "s" : ""}`, team: 1 });
    if (t2) items.push({ label: `${t2} Tour${t2 > 1 ? "s" : ""}`, team: 2 });
  }
  return items;
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Props
 *  team1Abbr / team1Stats : backend team1 (peut être user ou adversaire)
 *  team2Abbr / team2Stats : backend team2
 *  winnerTeam  : 1 ou 2  (numérotation backend)
 *  userIsTeam1 : true si l'utilisateur est team1 dans le backend
 *                → détermine quel côté afficher à gauche
 */
const MatchTimeline = ({
  phases = [], events = [],
  team1Abbr, team2Abbr,
  team1Stats = [], team2Stats = [],
  duration    = 30,
  winnerTeam  = 0,
  userIsTeam1 = true,
  onContinue,
}) => {
  // Côtés gauche/droite : user toujours à gauche
  const leftNum   = userIsTeam1 ? 1 : 2;
  const rightNum  = userIsTeam1 ? 2 : 1;
  const leftAbbr  = userIsTeam1 ? team1Abbr  : team2Abbr;
  const rightAbbr = userIsTeam1 ? team2Abbr  : team1Abbr;
  const leftStats  = userIsTeam1 ? team1Stats : team2Stats;
  const rightStats = userIsTeam1 ? team2Stats : team1Stats;
  const userWon   = winnerTeam === leftNum;

  // Couleur par numéro backend (pour objectifs / events qui utilisent team: 1|2)
  const tc = (n) => n === 1 ? "var(--primary)" : "var(--danger)";
  const tn = (n) => n === 1 ? team1Abbr : team2Abbr;

  // ── Build flat timeline + kill increments ────────────────────────────────
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

    // kills1/kills2 = backend team1/team2 totals (alignés avec team: 1|2 des events)
    const tK1 = (team1Stats || []).reduce((s, p) => s + (p.kills || 0), 0);
    const tK2 = (team2Stats || []).reduce((s, p) => s + (p.kills || 0), 0);

    const incs = items.map(() => [0, 0]);
    let rem1 = tK1, rem2 = tK2;

    // First blood : +1 kill à l'équipe qui l'obtient
    items.forEach((it, i) => {
      if (it._kind === "event" && it.type === "first_blood") {
        if (it.team === 1) { incs[i][0] += 1; rem1 = Math.max(0, rem1 - 1); }
        else               { incs[i][1] += 1; rem2 = Math.max(0, rem2 - 1); }
      }
    });

    // Teamfights : distribuer les kills des DEUX équipes sur TOUS les teamfights
    // (même quand une équipe domine, l'adversaire a quand même quelques kills)
    const allTF = items
      .map((it, i) => (it._kind === "event" && it.type === "teamfight") ? i : -1)
      .filter(x => x >= 0);

    if (allTF.length > 0) {
      const per1 = Math.floor(rem1 / allTF.length);
      const per2 = Math.floor(rem2 / allTF.length);
      allTF.forEach((idx, i) => {
        const last = i === allTF.length - 1;
        incs[idx][0] += last ? rem1 - per1 * i : per1;
        incs[idx][1] += last ? rem2 - per2 * i : per2;
      });
    } else {
      // Pas de teamfight : vider les kills restants sur le dernier item
      const lastIdx = items.length - 1;
      if (lastIdx >= 0) { incs[lastIdx][0] += rem1; incs[lastIdx][1] += rem2; }
    }

    return { tl: items, killIncs: incs, totalK1: tK1, totalK2: tK2 };
  }, [phases, events, team1Stats, team2Stats]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── State ────────────────────────────────────────────────────────────────
  const [visible,       setVisible]       = useState(0);
  const [kills1,        setKills1]        = useState(0);  // backend team1
  const [kills2,        setKills2]        = useState(0);  // backend team2
  const [speedIdx,      setSpeedIdx]      = useState(0);
  const [playing,       setPlaying]       = useState(true);
  const [done,          setDone]          = useState(false);
  const [currentPhase,  setCurrentPhase]  = useState(null);

  // Kills affiché selon le côté
  const leftKills  = userIsTeam1 ? kills1 : kills2;
  const rightKills = userIsTeam1 ? kills2 : kills1;

  // ── Playback ──────────────────────────────────────────────────────────────
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

  // ── Skip ─────────────────────────────────────────────────────────────────
  const handleSkip = () => {
    setVisible(tl.length);
    setKills1(totalK1);
    setKills2(totalK2);
    if (phases.length > 0) setCurrentPhase(phases[phases.length - 1]);
    setDone(true);
    setPlaying(false);
  };

  // ── Gold bar (two-color split) ────────────────────────────────────────────
  const goldDiff   = currentPhase?.gold_diff || 0;
  const goldTeam   = currentPhase?.advantage || 0;          // 1 or 2 (backend)
  const goldOffset = Math.min(28, goldDiff / 500);
  // leftWidth = part du bar pour le user (toujours gauche)
  const leftWidth  = goldTeam === 0
    ? 50
    : goldTeam === leftNum
      ? 50 + goldOffset   // user a l'avantage
      : 50 - goldOffset;  // adversaire a l'avantage
  const goldLeaderAbbr = goldTeam === leftNum ? leftAbbr : rightAbbr;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: "18px 22px", maxHeight: "82vh", overflowY: "auto" }}>

      {/* ── Kill scoreboard header ──────────────────────────────────────── */}
      <div style={{
        background: "var(--surface)", borderRadius: 8, padding: "14px 20px",
        marginBottom: 14, border: "1px solid rgba(255,255,255,0.07)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>

          {/* Gauche = user */}
          <div style={{ textAlign: "center", minWidth: 70 }}>
            <div style={{ fontSize: 10, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 }}>
              {leftAbbr}
            </div>
            <KillCounter value={leftKills} color="var(--primary)" />
          </div>

          {/* Centre : barre gold bicolore */}
          <div style={{ flex: 1, textAlign: "center", padding: "0 16px" }}>
            <div style={{ fontSize: 10, color: "var(--text-secondary)", marginBottom: 6 }}>KILLS</div>
            {/* Barre bicolore : bleu gauche | rouge droite */}
            <div style={{
              height: 8, borderRadius: 4, overflow: "hidden",
              background: "var(--danger)",  // rouge pour le fond (côté droit)
            }}>
              <motion.div
                animate={{ width: `${leftWidth}%` }}
                transition={{ duration: 0.7, ease: "easeInOut" }}
                style={{
                  height: "100%",
                  background: "var(--primary)",  // bleu côté gauche (user)
                  borderRadius: "4px 0 0 4px",
                }}
              />
            </div>
            {goldDiff > 0 && (
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                style={{ fontSize: 10, color: "var(--text-secondary)", marginTop: 4 }}
              >
                <span style={{ color: goldTeam === leftNum ? "var(--primary)" : "var(--danger)", fontWeight: 700 }}>
                  {goldLeaderAbbr}
                </span>
                {" "}+{(goldDiff / 1000).toFixed(1)}k gold
              </motion.div>
            )}
          </div>

          {/* Droite = adversaire */}
          <div style={{ textAlign: "center", minWidth: 70 }}>
            <div style={{ fontSize: 10, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 }}>
              {rightAbbr}
            </div>
            <AnimatePresence mode="popLayout">
              <motion.div
                key={rightKills}
                initial={{ scale: 1.5, color: "#f87171" }}
                animate={{ scale: 1, color: "var(--danger)" }}
                transition={{ duration: 0.3 }}
                style={{ fontSize: 44, fontWeight: 800, lineHeight: 1 }}
              >
                {rightKills}
              </motion.div>
            </AnimatePresence>
          </div>

        </div>
      </div>

      {/* ── Speed controls ──────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 14 }}>
        {SPEEDS.map((s, i) => (
          <button key={s.label}
            onClick={() => { setSpeedIdx(i); if (!done) setPlaying(true); }}
            style={{
              padding: "4px 14px", borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: "pointer",
              border: `1px solid ${speedIdx === i ? "var(--secondary)" : "rgba(255,255,255,0.14)"}`,
              background: speedIdx === i ? "rgba(255,184,0,0.12)" : "transparent",
              color: speedIdx === i ? "var(--secondary)" : "var(--text-secondary)",
              transition: "all 0.15s",
            }}
          >
            {s.label}
          </button>
        ))}
        <button onClick={handleSkip} disabled={done}
          style={{
            padding: "4px 14px", borderRadius: 20, fontSize: 12, fontWeight: 700, marginLeft: 4,
            cursor: done ? "default" : "pointer",
            border: "1px solid rgba(255,255,255,0.14)", background: "transparent",
            color: done ? "rgba(255,255,255,0.2)" : "var(--text-secondary)",
          }}
        >
          ⏭ Skip
        </button>
        {!done && (
          <button onClick={() => setPlaying(p => !p)}
            style={{
              padding: "4px 12px", borderRadius: 20, fontSize: 13, fontWeight: 700, cursor: "pointer",
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
              <motion.div key={`phase-${i}`}
                initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
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
                        background: tc(obj.team) + "1e", border: `1px solid ${tc(obj.team)}50`,
                        borderRadius: 12, padding: "1px 8px", fontSize: 10, fontWeight: 600, color: tc(obj.team),
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
              <motion.div key={`ev-${i}`}
                initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
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
                  <span style={{ fontWeight: 700, color: tc(item.team), fontSize: 11 }}>{tn(item.team)}</span>
                )}
              </motion.div>
            );
          }

          if (item._kind === "end") {
            return (
              <motion.div key="end"
                initial={{ opacity: 0, scale: 0.93 }} animate={{ opacity: 1, scale: 1 }}
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

        {!done && playing && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", color: "var(--text-secondary)", fontSize: 12 }}>
            <motion.span animate={{ opacity: [0.2, 1, 0.2] }} transition={{ duration: 1.1, repeat: Infinity }}>●</motion.span>
            Simulation en cours...
          </div>
        )}
      </div>

      {/* ── Scoreboard joueurs ───────────────────────────────────────────── */}
      {done && (leftStats.length > 0 || rightStats.length > 0) && (
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          style={{ marginTop: 18 }}
        >
          <div style={{
            fontSize: 11, fontWeight: 700, textTransform: "uppercase",
            letterSpacing: 1, color: "var(--text-secondary)", marginBottom: 10,
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

      {/* ── Continue ─────────────────────────────────────────────────────── */}
      {done && (
        <motion.button
          className="btn-primary"
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
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

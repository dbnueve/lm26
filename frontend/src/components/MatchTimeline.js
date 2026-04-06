import React from "react";
import { motion } from "framer-motion";

// Match Timeline Component — shown between "playing" and the result screen
const MatchTimeline = ({ phases = [], events = [], team1Abbr, team2Abbr, onContinue }) => {
  const teamName = (n) => n === 1 ? team1Abbr : team2Abbr;
  const phaseIcon = { "Early Game": "🌅", "Mid Game": "⚔️", "Late Game": "🏰" };
  const eventIcon = { first_blood: "🩸", teamfight: "⚔️", game_end: "🏆" };
  const posColor = (n) => n === 1 ? "var(--primary)" : "var(--danger)";

  // Build enriched event list from phases + events
  const phaseObjectives = phases.map((ph) => {
    const items = [];
    if (ph.first_blood) items.push({ label: "First Blood", team: ph.first_blood });
    if (ph.first_drake) items.push({ label: "Premier Drake", team: ph.first_drake });
    if (ph.first_tower) items.push({ label: "Première Tour", team: ph.first_tower });
    if (ph.rift_herald) items.push({ label: "Rift Herald", team: ph.rift_herald });
    if (ph.drakes) {
      const d1 = ph.drakes[1] || 0, d2 = ph.drakes[2] || 0;
      if (d1 > 0) items.push({ label: `${d1} Drake${d1 > 1 ? "s" : ""}`, team: 1 });
      if (d2 > 0) items.push({ label: `${d2} Drake${d2 > 1 ? "s" : ""}`, team: 2 });
    }
    if (ph.baron) items.push({ label: "Baron Nashor", team: ph.baron });
    if (ph.elder_drake) items.push({ label: "Elder Drake", team: ph.elder_drake });
    if (ph.towers_destroyed) {
      const t1 = ph.towers_destroyed[1] || 0, t2 = ph.towers_destroyed[2] || 0;
      if (t1 > 0) items.push({ label: `${t1} Tour${t1 > 1 ? "s" : ""}`, team: 1 });
      if (t2 > 0) items.push({ label: `${t2} Tour${t2 > 1 ? "s" : ""}`, team: 2 });
    }
    return { ...ph, objectives: items };
  });

  const winnerEvent = events.find(e => e.type === "game_end");

  return (
    <div style={{ padding: 24 }}>
      <h3 className="font-heading" style={{ fontSize: 22, marginBottom: 20, textAlign: "center" }}>
        Déroulement de la partie
      </h3>

      {/* Phase blocks */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
        {phaseObjectives.map((ph, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.15 }}
            style={{ background: "var(--surface)", border: `2px solid ${ph.advantage === 1 ? "var(--primary)" : "var(--danger)"}`, borderRadius: 4, padding: "12px 16px" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontWeight: 700 }}>{phaseIcon[ph.name] || "📍"} {ph.name}</span>
              <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{ph.duration}</span>
              <span style={{ fontWeight: 700, color: posColor(ph.advantage) }}>
                {teamName(ph.advantage)} domine · +{(ph.gold_diff / 1000).toFixed(1)}k gold
              </span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {ph.objectives.map((obj, j) => (
                <span key={j} style={{
                  background: posColor(obj.team) + "22",
                  border: `1px solid ${posColor(obj.team)}`,
                  borderRadius: 20, padding: "2px 10px", fontSize: 11, fontWeight: 600,
                  color: posColor(obj.team)
                }}>
                  {teamName(obj.team)} — {obj.label}
                </span>
              ))}
            </div>
          </motion.div>
        ))}
      </div>

      {/* Key events */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "var(--text-secondary)", marginBottom: 10 }}>Événements clés</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {events.map((ev, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.45 + i * 0.1 }}
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", background: "var(--surface)", borderRadius: 3 }}
            >
              <span style={{ fontSize: 18 }}>{eventIcon[ev.type] || "📌"}</span>
              <span style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-secondary)", minWidth: 40 }}>{ev.time}</span>
              <span style={{ flex: 1, fontSize: 13 }}>{ev.description.replace(/l'équipe 1/gi, team1Abbr).replace(/l'équipe 2/gi, team2Abbr)}</span>
              {ev.team && <span style={{ fontWeight: 700, color: posColor(ev.team), fontSize: 12 }}>{teamName(ev.team)}</span>}
            </motion.div>
          ))}
        </div>
      </div>

      {/* Nexus / result teaser */}
      {winnerEvent && (
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.7 }}
          style={{ textAlign: "center", padding: "16px", background: "rgba(255,184,0,0.08)", border: "1px solid var(--secondary)", borderRadius: 4, marginBottom: 20 }}
        >
          <span style={{ fontSize: 24 }}>💥</span>
          <div className="font-heading" style={{ fontSize: 18, marginTop: 4 }}>
            {teamName(winnerEvent.team)} détruit le Nexus à {winnerEvent.time} !
          </div>
        </motion.div>
      )}

      <motion.button
        className="btn-primary"
        style={{ width: "100%", padding: 14, fontSize: 15 }}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.9 }}
        onClick={onContinue}
      >
        Voir le résultat final →
      </motion.button>
    </div>
  );
};

export default MatchTimeline;

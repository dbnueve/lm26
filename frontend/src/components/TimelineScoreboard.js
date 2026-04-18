import React from "react";
import { motion } from "framer-motion";
import { _ddVersion, toDDragonKey } from "./ddHelpers";
import { calcNote } from "./timelineHelpers";

export default function TimelineScoreboard({
  leftStats, rightStats, leftAbbr, rightAbbr, userWon, duration,
}) {
  const blocks = [
    { stats: leftStats, won: userWon, abbr: leftAbbr },
    { stats: rightStats, won: !userWon, abbr: rightAbbr },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      style={{ flexShrink: 0 }}
    >
      <div style={{
        fontSize: 11, fontWeight: 700, textTransform: "uppercase",
        letterSpacing: 1, color: "var(--text-2)", marginBottom: 8,
      }}>
        Scoreboard
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {blocks.map(({ stats, won, abbr }, teamIdx) => (
          <div key={teamIdx} style={{ background: "var(--surface-1)", borderRadius: 6, overflow: "hidden" }}>
            <div style={{
              padding: "6px 12px", fontWeight: 700, fontSize: 12,
              background: won ? "var(--accent)" : "var(--danger)",
              color: won ? "black" : "white",
            }}>
              {abbr} — {won ? "Victoire ✓" : "Défaite"}
            </div>
            <div style={{
              display: "grid", gridTemplateColumns: "26px 1fr 70px 36px 44px 46px",
              padding: "5px 10px", gap: 2,
              fontSize: 10, color: "var(--text-2)", fontWeight: 600, textTransform: "uppercase",
            }}>
              <span /><span>Joueur</span>
              <span style={{ textAlign: "center" }}>K/D/A</span>
              <span style={{ textAlign: "center" }}>Note</span>
              <span style={{ textAlign: "center" }}>CS/m</span>
              <span style={{ textAlign: "right" }}>DMG</span>
            </div>
            {stats.map((p, i) => {
              const note = calcNote(p, duration, won);
              const isGood = note >= 7, isBad = note <= 3;
              return (
                <div key={i} style={{
                  display: "grid", gridTemplateColumns: "26px 1fr 70px 36px 44px 46px",
                  padding: "5px 10px", gap: 2,
                  borderTop: "1px solid var(--border)", alignItems: "center",
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
                    <span style={{ color: "var(--text-2)" }}>/</span>
                    <span style={{ color: "var(--danger)" }}>{p.deaths}</span>
                    <span style={{ color: "var(--text-2)" }}>/</span>
                    <span style={{ color: "var(--accent)" }}>{p.assists}</span>
                  </span>
                  <span style={{
                    textAlign: "center", fontSize: 11, fontWeight: 700,
                    color: isGood ? "var(--success)" : isBad ? "var(--danger)" : "var(--accent)",
                  }}>
                    {note.toFixed(1)}
                  </span>
                  <span style={{ textAlign: "center", fontSize: 11 }}>
                    {duration ? (p.cs / Math.max(1, duration)).toFixed(1) : "-"}
                  </span>
                  <span style={{ textAlign: "right", fontSize: 11, color: "var(--amber)" }}>
                    {p.damage ? (p.damage / 1000).toFixed(1) + "k" : "-"}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </motion.div>
  );
}

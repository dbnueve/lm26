import React from "react";
import { motion } from "framer-motion";
import { _ddVersion, toDDragonKey } from "./ddHelpers";
import { EVENT_ICON, KILL_TYPES } from "./timelineHelpers";
import { EventIcon, EVENT_ICON_URLS } from "./MiniMap";

const TimelineEventRow = React.memo(function TimelineEventRow({ item, tc, tn, drakeIndex = null }) {
  const icon = EVENT_ICON[item.type] || "📌";
  const hasUrlIcon = !!EVENT_ICON_URLS[item.type] || (item.type === "drake" && drakeIndex != null);
  const isBig = ["baron", "elder", "penta_kill", "quadra_kill", "game_end"].includes(item.type);
  const isMulti = ["double_kill", "triple_kill", "quadra_kill", "penta_kill"].includes(item.type);
  const isKill = KILL_TYPES.has(item.type);

  const desc = (item.description || "")
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
          border: "2px solid var(--amber)",
          borderRadius: 8,
        }}
      >
        <div style={{ fontSize: 28 }}>💥</div>
        <div style={{ fontWeight: 800, fontSize: 16, marginTop: 4, color: "var(--amber)" }}>
          {desc}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 2 }}>
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
          : "var(--surface-1)",
        borderLeft: `3px solid ${teamColor}`,
        borderTop: isBig ? `1px solid ${teamColor}55` : "none",
        borderRight: isBig ? `1px solid ${teamColor}25` : "none",
        borderBottom: isBig ? `1px solid ${teamColor}25` : "none",
      }}
    >
      {hasUrlIcon ? (
        <EventIcon
          type={item.type}
          drakeIndex={drakeIndex}
          size={isBig ? 18 : 14}
          style={{ flexShrink: 0 }}
        />
      ) : (
        <span style={{ fontSize: isBig ? 18 : 14, flexShrink: 0 }}>{icon}</span>
      )}
      <span style={{
        fontFamily: "monospace", fontSize: 10,
        color: "var(--text-2)",
        minWidth: 34, flexShrink: 0,
      }}>
        {item.time}
      </span>
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
        color: isMulti ? teamColor : "var(--text-1)",
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

export default TimelineEventRow;

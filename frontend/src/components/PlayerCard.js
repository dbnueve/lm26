import React, { useContext, memo } from "react";
import { motion } from "framer-motion";
import { ArrowsClockwise } from "@phosphor-icons/react";
import { PlayerImagesContext } from "../shared";
import { _ddVersion, toDDragonKey } from "./ddHelpers";

const getRatingColor = (rating) => {
  if (rating >= 85) return "var(--success)";
  if (rating >= 75) return "var(--amber)";
  return "var(--danger)";
};

const StatBar = ({ label, value, color }) => (
  <div style={{ marginBottom: 6 }}>
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
      <span style={{ color: "var(--text-2)" }}>{label}</span>
      <span className="font-stats" style={{ fontWeight: 500, color }}>{value}%</span>
    </div>
    <div style={{ height: 3, background: "var(--surface-3)", borderRadius: 99 }}>
      <div style={{ height: "100%", borderRadius: 2, background: color, width: value + "%", transition: "width 0.4s ease" }} />
    </div>
  </div>
);

const PlayerCard = memo(({ player, onSelect, showActions = false, onSwap }) => {
  const playerImages = useContext(PlayerImagesContext);
  const imageUrl = playerImages[player.name.toLowerCase()];
  const sigChamp = player.champion_pool?.[0];
  const splashKey = sigChamp ? toDDragonKey(sigChamp) : null;
  const splashUrl = splashKey
    ? `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${splashKey}_0.jpg`
    : null;

  return (
    <motion.div
      className={"player-card " + (player.is_starter ? "starter" : "bench")}
      whileHover={{ y: -4 }}
      onClick={() => onSelect && onSelect(player)}
      data-testid={"player-card-" + player.id}
      style={{ position: "relative", overflow: "hidden" }}
    >
      {/* Champion splash art background for starters */}
      {player.is_starter && splashUrl && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 0,
          backgroundImage: `url(${splashUrl})`,
          backgroundSize: "cover", backgroundPosition: "center top",
          opacity: 0.07,
          pointerEvents: "none",
        }} />
      )}

      <div style={{ position: "relative", zIndex: 1 }}>
        <div className="player-header">
          <div className="player-avatar hex-avatar" style={{ overflow: "hidden", padding: 0 }}>
            {imageUrl
              ? <img loading="lazy" src={imageUrl} alt={player.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={e => { e.currentTarget.style.display = "none"; e.currentTarget.parentNode.textContent = player.name.substring(0, 2).toUpperCase(); }} />
              : player.name.substring(0, 2).toUpperCase()
            }
          </div>
          <div className="player-info">
            <div className="player-name">{player.name}</div>
            <div className="player-meta">
              <span className={"pos-badge pos-" + player.position}>{player.position}</span>
              <span>{player.nationality}</span>
              <span>{player.age} ans</span>
            </div>
            {sigChamp && (
              <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4 }}>
                <img loading="lazy"
                  src={`https://ddragon.leagueoflegends.com/cdn/${_ddVersion}/img/champion/${splashKey}.png`}
                  alt={sigChamp}
                  style={{ width: 16, height: 16, borderRadius: 3, objectFit: "cover" }}
                  onError={e => { e.currentTarget.style.display = "none"; }}
                />
                <span style={{ fontSize: 11, color: "var(--text-2)" }}>{sigChamp}</span>
              </div>
            )}
          </div>
          <div className="player-rating" style={{ color: getRatingColor(player.rating) }}>
            {player.rating}
          </div>
        </div>

        <div className="player-stats">
          <div className="stat-item">
            <span className="stat-label">Mécanique</span>
            <span className="stat-value font-stats">{player.mechanics}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Game Sense</span>
            <span className="stat-value font-stats">{player.game_sense}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">KDA</span>
            <span className="stat-value font-stats">{player.kda}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">CS/min</span>
            <span className="stat-value font-stats">{player.cs_min}</span>
          </div>
        </div>

        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 2 }}>
          <StatBar
            label="Moral"
            value={player.moral ?? 0}
            color={player.moral > 70 ? "var(--success)" : player.moral > 40 ? "var(--amber)" : "var(--danger)"}
          />
          <StatBar
            label="Fatigue"
            value={player.fatigue ?? 0}
            color={player.fatigue > 70 ? "var(--danger)" : player.fatigue > 40 ? "var(--amber)" : "var(--success)"}
          />
        </div>

        {showActions && (
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <button
              className="btn-secondary"
              style={{ flex: 1, padding: "8px" }}
              onClick={(e) => { e.stopPropagation(); onSwap && onSwap(player); }}
              data-testid={"swap-btn-" + player.id}
            >
              <ArrowsClockwise size={16} /> Swap
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
});

PlayerCard.displayName = "PlayerCard";
export default PlayerCard;

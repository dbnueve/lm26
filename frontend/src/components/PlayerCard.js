import React from "react";
import { motion } from "framer-motion";
import { ArrowsClockwise } from "@phosphor-icons/react";
import { PlayerImagesContext } from "../shared";

const PlayerCard = ({ player, onSelect, showActions = false, onSwap }) => {
  const playerImages = React.useContext(PlayerImagesContext);
  const imageUrl = playerImages[player.name.toLowerCase()];

  const getRatingColor = (rating) => {
    if (rating >= 85) return "var(--success)";
    if (rating >= 75) return "var(--secondary)";
    return "var(--danger)";
  };

  return (
    <motion.div
      className={"player-card " + (player.is_starter ? "starter" : "bench")}
      whileHover={{ y: -4 }}
      onClick={() => onSelect && onSelect(player)}
      data-testid={"player-card-" + player.id}
    >
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

      <div style={{ marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
          <span>Moral</span>
          <span className="font-stats">{player.moral}%</span>
        </div>
        <div className="progress-bar">
          <div
            className="progress-fill"
            style={{
              width: player.moral + "%",
              background: player.moral > 70 ? "var(--success)" : player.moral > 40 ? "var(--secondary)" : "var(--danger)"
            }}
          />
        </div>
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
    </motion.div>
  );
};

export default PlayerCard;

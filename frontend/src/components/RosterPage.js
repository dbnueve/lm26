import React, { useState } from "react";
import { AnimatePresence } from "framer-motion";
import { X, ArrowsClockwise } from "@phosphor-icons/react";
import PlayerCard from "./PlayerCard";
import PlayerDetailModal from "./PlayerDetailModal";

// Roster Page Component
const RosterPage = ({ userTeam, onSwapPlayers }) => {
  const [swapMode, setSwapMode] = useState(false);
  const [selectedForSwap, setSelectedForSwap] = useState(null);
  const [detailPlayer, setDetailPlayer] = useState(null);

  const positions = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"];
  const players = userTeam.players || [];

  const handleSwap = (player) => {
    if (!swapMode) {
      setSwapMode(true);
      setSelectedForSwap(player);
    } else {
      if (player.position === selectedForSwap.position && player.id !== selectedForSwap.id) {
        onSwapPlayers(selectedForSwap.id, player.id);
      }
      setSwapMode(false);
      setSelectedForSwap(null);
    }
  };

  return (
    <div className="animate-slide-up">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h2 className="font-heading" style={{ fontSize: 32 }}>
          Effectif
        </h2>
        {swapMode && (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ color: "var(--secondary)" }}>
              Sélectionnez un joueur {selectedForSwap?.position} pour le swap
            </span>
            <button
              className="btn-secondary"
              onClick={() => { setSwapMode(false); setSelectedForSwap(null); }}
            >
              <X size={16} /> Annuler
            </button>
          </div>
        )}
      </div>

      {positions.map(pos => (
        <div key={pos} style={{ marginBottom: 32 }}>
          <h3 className="font-heading" style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
            <span className={"pos-badge pos-" + pos}>{pos}</span>
          </h3>
          <div className="grid-2">
            {players.filter(p => p.position === pos).map(player => (
              <PlayerCard
                key={player.id}
                player={player}
                showActions={true}
                onSwap={handleSwap}
                onSelect={setDetailPlayer}
              />
            ))}
          </div>
        </div>
      ))}

      <AnimatePresence>
        {detailPlayer && (
          <PlayerDetailModal
            player={detailPlayer}
            onClose={() => setDetailPlayer(null)}
            actions={
              <button className="btn-secondary" style={{ width: "100%" }}
                onClick={() => { handleSwap(detailPlayer); setDetailPlayer(null); }}>
                <ArrowsClockwise size={16} style={{ marginRight: 8 }} />
                Proposer un swap
              </button>
            }
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default RosterPage;

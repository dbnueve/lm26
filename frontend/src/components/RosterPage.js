import React, { useState } from "react";
import { AnimatePresence } from "framer-motion";
import { X, ArrowsClockwise } from "@phosphor-icons/react";
import PlayerCard from "./PlayerCard";
import PlayerDetailModal from "./PlayerDetailModal";

const POSITIONS = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"];

const RosterPage = ({ userTeam, onSwapPlayers }) => {
  const [swapMode, setSwapMode]             = useState(false);
  const [selectedForSwap, setSelectedForSwap] = useState(null);
  const [detailPlayer, setDetailPlayer]     = useState(null);

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

  const cancelSwap = () => { setSwapMode(false); setSelectedForSwap(null); };

  return (
    <div className="animate-slide-up" style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h2 className="font-heading" style={{ fontSize: 22, letterSpacing: "-0.02em" }}>Effectif</h2>
          <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 2 }}>
            {players.length} joueurs · {players.filter(p => p.is_starter).length} titulaires
          </div>
        </div>
        {swapMode && (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 13, color: "var(--amber)" }}>
              Sélectionnez un joueur {selectedForSwap?.position} à swapper
            </span>
            <button className="btn-secondary" onClick={cancelSwap}
              style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <X size={14} /> Annuler
            </button>
          </div>
        )}
      </div>

      {/* Position sections */}
      {POSITIONS.map(pos => {
        const posPlayers = players.filter(p => p.position === pos);
        if (!posPlayers.length) return null;
        return (
          <div key={pos}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <span className={"pos-badge pos-" + pos}>{pos}</span>
              <div style={{ height: 1, flex: 1, background: "var(--border)" }} />
              <span style={{ fontSize: 12, color: "var(--text-2)" }}>{posPlayers.length} joueur{posPlayers.length > 1 ? "s" : ""}</span>
            </div>
            <div className="grid-2">
              {posPlayers.map(player => (
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
        );
      })}

      <AnimatePresence>
        {detailPlayer && (
          <PlayerDetailModal
            player={detailPlayer}
            onClose={() => setDetailPlayer(null)}
            actions={
              <button className="btn-secondary" style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
                onClick={() => { handleSwap(detailPlayer); setDetailPlayer(null); }}>
                <ArrowsClockwise size={15} />
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

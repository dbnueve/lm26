import React, { useState, useMemo, useCallback } from "react";
import { motion } from "framer-motion";
import { Sword, ChartBar, Fire, ClockCounterClockwise, Check } from "@phosphor-icons/react";

// Training Page Component
const TrainingPage = ({ userTeam, onApplyTraining }) => {
  const [selectedTraining, setSelectedTraining] = useState(null);
  const [selectedPlayer, setSelectedPlayer] = useState(null);

  const trainingOptions = useMemo(() => [
    { id: "scrims", name: "Scrims", icon: Sword, cost: 50000, description: "Matchs d entrainement", effects: "+2 Mécanique, +3 Teamwork, +15 Fatigue" },
    { id: "vod_review", name: "VOD Review", icon: ChartBar, cost: 20000, description: "Analyse de parties", effects: "+3 Game Sense, +2 Consistance" },
    { id: "bootcamp", name: "Bootcamp", icon: Fire, cost: 100000, description: "Entrainement intensif", effects: "+4 Mécanique, +3 Clutch, +25 Fatigue" },
    { id: "rest", name: "Repos", icon: ClockCounterClockwise, cost: 0, description: "Récupération", effects: "-30 Fatigue, +15 Moral" }
  ], []);

  const starters = useMemo(() =>
    userTeam.players?.filter(p => p.is_starter) || [],
    [userTeam.players]
  );

  const handleApply = useCallback(async () => {
    if (selectedTraining && selectedPlayer) {
      await onApplyTraining(selectedPlayer.id, selectedTraining.id);
      setSelectedTraining(null);
      setSelectedPlayer(null);
    }
  }, [selectedTraining, selectedPlayer, onApplyTraining]);

  return (
    <div className="animate-slide-up">
      <h2 className="font-heading" style={{ fontSize: 32, marginBottom: 24 }}>
        Centre d Entrainement
      </h2>

      <div className="grid-2" style={{ marginBottom: 32 }}>
        <div>
          <h3 className="font-heading" style={{ marginBottom: 16, color: "var(--text-secondary)" }}>
            Options d entrainement
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {trainingOptions.map(training => (
              <motion.div
                key={training.id}
                className={"card " + (selectedTraining?.id === training.id ? "card-gold" : "")}
                style={{ padding: 20, cursor: "pointer" }}
                whileHover={{ x: 4 }}
                onClick={() => setSelectedTraining(training)}
                data-testid={"training-" + training.id}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <div style={{
                    width: 48,
                    height: 48,
                    background: "var(--surface-hover)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 4
                  }}>
                    <training.icon size={24} style={{ color: "var(--secondary)" }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{training.name}</div>
                    <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>{training.description}</div>
                    <div style={{ fontSize: 12, color: "var(--primary)", marginTop: 4 }}>{training.effects}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="font-stats" style={{ color: "var(--secondary)", fontWeight: 700 }}>
                      {training.cost > 0 ? (training.cost / 1000).toFixed(0) + "K EUR" : "Gratuit"}
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="font-heading" style={{ marginBottom: 16, color: "var(--text-secondary)" }}>
            Sélectionner un joueur
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {starters.map(player => (
              <motion.div
                key={player.id}
                className={"card " + (selectedPlayer?.id === player.id ? "card-gold" : "")}
                style={{ padding: 16, cursor: "pointer" }}
                whileHover={{ x: 4 }}
                onClick={() => setSelectedPlayer(player)}
                data-testid={"train-player-" + player.id}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span className={"pos-badge pos-" + player.position}>{player.position}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{player.name}</div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                      Fatigue: {player.fatigue}% | Moral: {player.moral}%
                    </div>
                  </div>
                  <div className="font-stats" style={{ fontSize: 24, fontWeight: 700, color: "var(--primary)" }}>
                    {player.rating}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>

      {selectedTraining && selectedPlayer && (
        <div style={{
          padding: 24,
          background: "var(--surface)",
          border: "1px solid var(--border-active)",
          borderRadius: 2
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h4>Appliquer {selectedTraining.name} a {selectedPlayer.name}</h4>
              <div style={{ color: "var(--text-secondary)", marginTop: 4 }}>{selectedTraining.effects}</div>
            </div>
            <button
              className="btn-primary"
              onClick={handleApply}
              disabled={selectedTraining.cost > userTeam.budget}
              data-testid="apply-training-btn"
            >
              <Check size={20} style={{ marginRight: 8 }} />
              Appliquer
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default TrainingPage;

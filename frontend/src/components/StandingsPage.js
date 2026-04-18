import React, { useState } from "react";
import { AnimatePresence } from "framer-motion";
import TeamLogo from "./TeamLogo";
import TeamDetailModal from "./TeamDetailModal";

// Standings Page
const StandingsPage = ({ standings, userTeam }) => {
  const [selectedTeam, setSelectedTeam] = useState(null);

  return (
    <div className="animate-slide-up">
      <h2 className="font-heading" style={{ fontSize: 32, marginBottom: 24 }}>
        Classement
      </h2>

      <div className="standings-table">
        <div className="standings-header">
          <span>#</span>
          <span>Équipe</span>
          <span>V</span>
          <span>D</span>
          <span>Win Rate</span>
          <span>Elo</span>
        </div>
        {standings.map((team, index) => (
          <div
            key={team.id}
            className={"standings-row " + (team.id === userTeam.id ? "my-team " : "") + (team.qualified ? "qualified" : "")}
            data-testid={"standing-" + team.id}
            onClick={() => setSelectedTeam(team)}
            style={{ cursor: "pointer" }}
          >
            <span className="font-stats" style={{ fontWeight: 700, fontSize: 18 }}>{index + 1}</span>
            <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <TeamLogo teamId={team.id} abbr={team.abbr} size={28} />
              <span style={{ color: "var(--text-2)" }}>{team.name}</span>
              {team.qualified && (
                <span style={{
                  background: "var(--success)",
                  color: "black",
                  padding: "2px 8px",
                  fontSize: 10,
                  fontWeight: 700,
                  borderRadius: 2
                }}>
                  PLAYOFFS
                </span>
              )}
            </span>
            <span className="font-stats" style={{ fontWeight: 700, color: "var(--success)" }}>{team.wins}</span>
            <span className="font-stats" style={{ fontWeight: 700, color: "var(--danger)" }}>{team.losses}</span>
            <span className="font-stats" style={{ fontWeight: 700 }}>{team.win_rate}%</span>
            <span className="font-stats" style={{ fontWeight: 700, color: "var(--accent)" }}>{team.elo}</span>
          </div>
        ))}
      </div>

      <AnimatePresence>
        {selectedTeam && <TeamDetailModal team={selectedTeam} onClose={() => setSelectedTeam(null)} />}
      </AnimatePresence>
    </div>
  );
};

export default StandingsPage;

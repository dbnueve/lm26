import React, { useState } from "react";
import { AnimatePresence } from "framer-motion";
import TeamLogo from "./TeamLogo";
import TeamDetailModal from "./TeamDetailModal";

const StandingsPage = ({ standings, userTeam }) => {
  const [selectedTeam, setSelectedTeam] = useState(null);

  return (
    <div className="animate-slide-up" style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      <div>
        <h2 className="font-heading" style={{ fontSize: 22, letterSpacing: "-0.02em" }}>Classement</h2>
        <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 2 }}>
          {standings.length} équipes · Cliquez sur une équipe pour les détails
        </div>
      </div>

      <div className="standings-table">
        {/* Header */}
        <div className="standings-header">
          <span>#</span>
          <span>Équipe</span>
          <span style={{ textAlign: "center" }}>V</span>
          <span style={{ textAlign: "center" }}>D</span>
          <span style={{ textAlign: "center" }}>Win %</span>
          <span style={{ textAlign: "center" }}>Elo</span>
        </div>

        {standings.map((team, index) => {
          const isUser = team.id === userTeam.id;
          const isTop  = team.qualified;
          return (
            <div
              key={team.id}
              className={"standings-row " + (isUser ? "my-team " : "") + (isTop ? "qualified" : "")}
              data-testid={"standing-" + team.id}
              onClick={() => setSelectedTeam(team)}
              style={{ cursor: "pointer" }}
            >
              {/* Rank */}
              <span className="font-stats" style={{
                fontWeight: 700, fontSize: 15,
                color: index < 3 ? "var(--amber)" : isUser ? "var(--accent)" : "var(--text-2)",
              }}>
                {index + 1}
              </span>

              {/* Team */}
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <TeamLogo teamId={team.id} abbr={team.abbr} size={24} />
                <span style={{ fontWeight: isUser ? 700 : 400, fontSize: 13 }}>{team.name}</span>
                {isTop && (
                  <span className="chip chip-success" style={{ fontSize: 10 }}>PLAYOFFS</span>
                )}
              </span>

              {/* W */}
              <span className="font-stats" style={{ textAlign: "center", fontWeight: 600, color: "var(--success)", fontSize: 13 }}>
                {team.wins}
              </span>

              {/* L */}
              <span className="font-stats" style={{ textAlign: "center", fontWeight: 600, color: "var(--danger)", fontSize: 13 }}>
                {team.losses}
              </span>

              {/* Win rate */}
              <span className="font-stats" style={{ textAlign: "center", fontSize: 13 }}>
                {team.win_rate}%
              </span>

              {/* Elo */}
              <span className="font-stats" style={{ textAlign: "center", fontWeight: 600, color: "var(--accent)", fontSize: 13 }}>
                {team.elo}
              </span>
            </div>
          );
        })}
      </div>

      <AnimatePresence>
        {selectedTeam && <TeamDetailModal team={selectedTeam} onClose={() => setSelectedTeam(null)} />}
      </AnimatePresence>
    </div>
  );
};

export default StandingsPage;

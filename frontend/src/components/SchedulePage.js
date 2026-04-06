import React, { useState } from "react";
import { ArrowsClockwise } from "@phosphor-icons/react";
import axios from "axios";
import { API } from "../shared";
import TeamLogo from "./TeamLogo";

// Schedule Page
const SchedulePage = ({ schedule, teams, userTeam, onSimulateSeason }) => {
  const getTeamAbbr = (teamId) => teams.find(t => t.id === teamId)?.abbr || teamId;
  const [simulating, setSimulating] = useState(false);

  const userMatches = schedule.filter(m => m.team1 === userTeam.id || m.team2 === userTeam.id);
  const hasUnplayed = userMatches.some(m => !m.played);
  const groupedByWeek = userMatches.reduce((acc, match) => {
    if (!acc[match.week]) acc[match.week] = [];
    acc[match.week].push(match);
    return acc;
  }, {});

  const handleSimulate = async () => {
    setSimulating(true);
    try { await onSimulateSeason(); } finally { setSimulating(false); }
  };

  return (
    <div className="animate-slide-up">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <h2 className="font-heading" style={{ fontSize: 32 }}>Calendrier</h2>
        {hasUnplayed && (
          <button className="btn-secondary" onClick={handleSimulate} disabled={simulating}
            style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ArrowsClockwise size={16} />
            {simulating ? "Simulation..." : "Simuler la saison"}
          </button>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {Object.entries(groupedByWeek).map(([week, matches]) => (
          <div key={week} className="card" style={{ padding: 20 }}>
            <h4 className="font-heading" style={{ marginBottom: 16, color: "var(--text-secondary)" }}>
              Semaine {week}
            </h4>
            {matches.map(match => (
              <div
                key={match.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "12px 0",
                  borderBottom: "1px solid var(--border-subtle)"
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 16, flex: 1 }}>
                  <TeamLogo teamId={match.team1} abbr={getTeamAbbr(match.team1)} size={32} />
                </div>

                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 16px",
                  background: match.played ?
                    (match.winner === userTeam.id ? "rgba(0, 230, 118, 0.1)" : "rgba(255, 51, 102, 0.1)") :
                    "var(--surface-hover)",
                  borderRadius: 2
                }}>
                  {match.played ? (
                    <>
                      <span className="font-stats" style={{ fontSize: 20, fontWeight: 700 }}>
                        {match.score1}
                      </span>
                      <span style={{ color: "var(--text-secondary)" }}>-</span>
                      <span className="font-stats" style={{ fontSize: 20, fontWeight: 700 }}>
                        {match.score2}
                      </span>
                    </>
                  ) : (
                    <span style={{ color: "var(--text-secondary)" }}>A jouer</span>
                  )}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 16, flex: 1, justifyContent: "flex-end" }}>
                  <TeamLogo teamId={match.team2} abbr={getTeamAbbr(match.team2)} size={32} />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};

export default SchedulePage;

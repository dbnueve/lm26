import React, { useState } from "react";
import { ArrowsClockwise } from "@phosphor-icons/react";
import TeamLogo from "./TeamLogo";

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
    <div className="animate-slide-up" style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h2 className="font-heading" style={{ fontSize: 22, letterSpacing: "-0.02em" }}>Calendrier</h2>
          <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 2 }}>
            {userMatches.filter(m => m.played).length} / {userMatches.length} matchs joués
          </div>
        </div>
        {hasUnplayed && onSimulateSeason && (
          <button className="btn-secondary" onClick={handleSimulate} disabled={simulating}
            style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ArrowsClockwise size={15} className={simulating ? "animate-pulse-soft" : ""} />
            {simulating ? "Simulation…" : "Simuler la saison"}
          </button>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {Object.entries(groupedByWeek).map(([week, matches]) => {
          const weekPlayed = matches.every(m => m.played);
          return (
            <div key={week} className="card" style={{ padding: 0, overflow: "hidden" }}>
              {/* Week header */}
              <div style={{
                padding: "10px 16px",
                background: "var(--surface-2)",
                borderBottom: "1px solid var(--border)",
                display: "flex", alignItems: "center", justifyContent: "space-between",
              }}>
                <span className="text-label">Semaine {week}</span>
                {weekPlayed
                  ? <span style={{ fontSize: 11, color: "var(--success)", fontWeight: 600 }}>Terminée</span>
                  : <span style={{ fontSize: 11, color: "var(--accent)", fontWeight: 600 }}>En cours</span>
                }
              </div>

              {/* Matches */}
              {matches.map((match, idx) => {
                const isUser = match.team1 === userTeam.id || match.team2 === userTeam.id;
                const won = match.played && match.winner === userTeam.id;
                const lost = match.played && isUser && match.winner && match.winner !== userTeam.id;

                return (
                  <div key={match.id} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "12px 16px",
                    borderBottom: idx < matches.length - 1 ? "1px solid var(--border)" : "none",
                    background: isUser ? "var(--accent-dim)" : "transparent",
                    borderLeft: isUser ? "2px solid var(--accent-border)" : "2px solid transparent",
                  }}>
                    {/* Team 1 */}
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
                      <TeamLogo teamId={match.team1} abbr={getTeamAbbr(match.team1)} size={28} />
                      <span style={{ fontSize: 13, fontWeight: match.team1 === userTeam.id ? 700 : 400 }}>
                        {getTeamAbbr(match.team1)}
                      </span>
                    </div>

                    {/* Score / Status */}
                    <div style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "5px 14px",
                      background: match.played
                        ? (won ? "var(--success-dim)" : lost ? "var(--danger-dim)" : "var(--surface-2)")
                        : "var(--surface-2)",
                      borderRadius: "var(--radius-xs)",
                      border: `1px solid ${won ? "var(--success-border)" : lost ? "var(--danger-border)" : "var(--border)"}`,
                      minWidth: 80, justifyContent: "center",
                    }}>
                      {match.played ? (
                        <>
                          <span className="font-stats" style={{ fontSize: 16, fontWeight: 600, color: won ? "var(--success)" : lost ? "var(--danger)" : "var(--text-1)" }}>
                            {match.score1}
                          </span>
                          <span style={{ color: "var(--text-2)", fontSize: 13 }}>–</span>
                          <span className="font-stats" style={{ fontSize: 16, fontWeight: 600, color: won ? "var(--success)" : lost ? "var(--danger)" : "var(--text-1)" }}>
                            {match.score2}
                          </span>
                        </>
                      ) : (
                        <span style={{ fontSize: 12, color: "var(--text-2)" }}>À jouer</span>
                      )}
                    </div>

                    {/* Team 2 */}
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, justifyContent: "flex-end" }}>
                      <span style={{ fontSize: 13, fontWeight: match.team2 === userTeam.id ? 700 : 400 }}>
                        {getTeamAbbr(match.team2)}
                      </span>
                      <TeamLogo teamId={match.team2} abbr={getTeamAbbr(match.team2)} size={28} />
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default SchedulePage;
